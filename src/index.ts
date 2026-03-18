import TelegramBot from 'node-telegram-bot-api'
import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
dotenv.config()

const BOT_TOKEN    = process.env.BOT_TOKEN!
const SUPABASE_URL = process.env.SUPABASE_URL!
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!
const REDIS_URL    = process.env.UPSTASH_REDIS_REST_URL!
const REDIS_TOKEN  = process.env.UPSTASH_REDIS_REST_TOKEN!

const bot      = new TelegramBot(BOT_TOKEN, { polling: true })
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

// ── Redis ─────────────────────────────────────────────────────
async function redisGet(key: string): Promise<string | null> {
  try {
    const r = await fetch(`${REDIS_URL}/get/${encodeURIComponent(key)}`, {
      headers: { Authorization: `Bearer ${REDIS_TOKEN}` }
    })
    const j = await r.json() as { result: string | null }
    return j.result ?? null
  } catch { return null }
}
async function redisDel(key: string): Promise<void> {
  try {
    await fetch(`${REDIS_URL}/del/${encodeURIComponent(key)}`, {
      headers: { Authorization: `Bearer ${REDIS_TOKEN}` }
    })
  } catch {}
}

// ── Helpers ───────────────────────────────────────────────────
function esc(t: string) {
  return String(t).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
}

type UserRow = { user_id: number; uuid: string | null; balance: number; nickname: string }

// Найти строку где user_id = tgId (старый бот-аккаунт)
async function findBotRow(tgId: number): Promise<UserRow | null> {
  const { data } = await (supabase.from('users') as any)
    .select('user_id, uuid, balance, nickname')
    .eq('user_id', tgId)
    .maybeSingle()
  return data ?? null
}

// Найти строку по uuid (сайтовый аккаунт)
async function findWebRow(uuid: string): Promise<UserRow | null> {
  const { data } = await (supabase.from('users') as any)
    .select('user_id, uuid, balance, nickname')
    .eq('uuid', uuid)
    .maybeSingle()
  return data ?? null
}

// Найти актуальную строку пользователя для бота (с uuid → это рабочий аккаунт)
async function findActiveRow(tgId: number): Promise<UserRow | null> {
  // Сначала ищем строку где user_id=tgId И uuid уже проставлен (после слияния)
  const botRow = await findBotRow(tgId)
  if (botRow && botRow.uuid) return botRow
  // Иначе ищем по referal=tgId (если слияние было через referal)
  const { data } = await (supabase.from('users') as any)
    .select('user_id, uuid, balance, nickname')
    .eq('referal', tgId)
    .maybeSingle()
  return data ?? botRow ?? null
}

// ── Keyboard ──────────────────────────────────────────────────
const kb = {
  keyboard: [
    [{ text: '🔗 Привязать аккаунт' }],
    [{ text: '💰 Мой баланс' }, { text: '📦 Мои заказы' }],
  ],
  resize_keyboard: true,
}

// ── /start ────────────────────────────────────────────────────
bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id
  const tgId   = msg.from!.id
  const name   = esc(msg.from!.first_name ?? 'Путник')
  const user   = await findActiveRow(tgId)

  const text = user?.uuid
    ? `👋 С возвращением, <b>${name}</b>!\n\n🏰 Аккаунт привязан.\n\nНикнейм: <b>${esc(user.nickname ?? '—')}</b>\nБаланс: <b>${user.balance ?? 0} ₮</b>\n\nДля смены аккаунта нажми <b>🔗 Привязать аккаунт</b>.`
    : `👋 Добро пожаловать, <b>${name}</b>!\n\n🏰 <b>Тридевятое Царство</b>\n\nДля привязки аккаунта сайта:\n\n<b>1.</b> Зайди на сайт → Профиль\n<b>2.</b> Нажми <b>«Привязать Telegram»</b>\n<b>3.</b> Получи 6-значный код\n<b>4.</b> Отправь его сюда\n\nПосле этого баланс, заказы и история объединятся.`

  await bot.sendMessage(chatId, text, { parse_mode: 'HTML', reply_markup: kb })
})

// ── Привязать ─────────────────────────────────────────────────
bot.onText(/🔗 Привязать аккаунт/, async (msg) => {
  await bot.sendMessage(msg.chat.id,
    `🔑 <b>Привязка аккаунта</b>\n\n<b>1.</b> Открой <b>farkgdm.shop</b>\n<b>2.</b> Профиль → <b>«Привязать Telegram»</b>\n<b>3.</b> Скопируй 6-значный код\n<b>4.</b> Отправь его сюда\n\n<i>⏱ Код действует 10 минут</i>`,
    { parse_mode: 'HTML' }
  )
})

// ── Баланс ────────────────────────────────────────────────────
bot.onText(/💰 Мой баланс/, async (msg) => {
  const user = await findActiveRow(msg.from!.id)
  if (!user?.uuid) {
    await bot.sendMessage(msg.chat.id, '❌ Аккаунт не привязан.\n\nНажми <b>🔗 Привязать аккаунт</b>.', { parse_mode: 'HTML', reply_markup: kb })
    return
  }
  await bot.sendMessage(msg.chat.id,
    `💰 <b>Баланс</b>\n\n<b>${user.balance ?? 0} ₮</b>\n\nНикнейм: ${esc(user.nickname ?? '—')}`,
    { parse_mode: 'HTML', reply_markup: kb }
  )
})

// ── Заказы ────────────────────────────────────────────────────
bot.onText(/📦 Мои заказы/, async (msg) => {
  const user = await findActiveRow(msg.from!.id)
  if (!user?.uuid) {
    await bot.sendMessage(msg.chat.id, '❌ Аккаунт не привязан.\n\nНажми <b>🔗 Привязать аккаунт</b>.', { parse_mode: 'HTML', reply_markup: kb })
    return
  }
  const { data: orders } = await (supabase.from('transaction') as any)
    .select('id_transaction, name_of_stuff, amount, city, time_created, not_found')
    .eq('uuid_user', user.uuid)
    .order('time_created', { ascending: false })
    .limit(5)

  if (!orders?.length) {
    await bot.sendMessage(msg.chat.id, '📦 Заказов пока нет.', { reply_markup: kb })
    return
  }
  const lines = orders.map((o: any) => {
    const date   = new Date(o.time_created).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })
    const status = Number(o.not_found ?? 0) > 0 ? '⚠️' : '✅'
    return `${status} <b>${esc(o.name_of_stuff ?? '—')}</b>\n   ${o.amount ?? 0}€ · ${esc(o.city ?? '—')} · ${date}`
  }).join('\n\n')

  await bot.sendMessage(msg.chat.id, `📦 <b>Последние заказы</b>\n\n${lines}`, { parse_mode: 'HTML', reply_markup: kb })
})

// ── 6-значный код ─────────────────────────────────────────────
bot.onText(/^(\d{6})$/, async (msg, match) => {
  const chatId = msg.chat.id
  const tgId   = msg.from!.id
  const code   = match![1]!

  const webUuid = await redisGet(`verify:${code}`)
  if (!webUuid) {
    await bot.sendMessage(chatId,
      '❌ <b>Код не найден или истёк</b>\n\nЗапроси новый код в профиле на сайте.',
      { parse_mode: 'HTML' }
    )
    return
  }
  await redisDel(`verify:${code}`)

  try {
    const webRow = await findWebRow(webUuid)   // сайтовая строка (uuid=webUuid)
    const botRow = await findBotRow(tgId)       // бот-строка (user_id=tgId)

    const webBalance = Number(webRow?.balance ?? 0)
    const botBalance = Number(botRow?.balance ?? 0)
    const finalBalance = Math.max(webBalance, botBalance)

    console.log(`LINK: tgId=${tgId} webUuid=${webUuid} webBal=${webBalance} botBal=${botBalance} final=${finalBalance}`)

    if (botRow) {
      // Есть старая бот-строка (user_id=tgId)
      // Стратегия: пишем webUuid в бот-строку, ставим MAX баланс, удаляем сайтовую

      // Переносим транзакции с webUuid на botRow.uuid (если у botRow есть свой uuid)
      if (botRow.uuid && botRow.uuid !== webUuid) {
        await (supabase.from('transaction') as any)
          .update({ uuid_user: webUuid })
          .eq('uuid_user', botRow.uuid)
        console.log(`Transferred txs from botUuid=${botRow.uuid} to webUuid=${webUuid}`)
      }

      // Пишем webUuid и MAX баланс в бот-строку (user_id=tgId остаётся)
      await (supabase.from('users') as any)
        .update({ uuid: webUuid, balance: finalBalance, nickname: webRow?.nickname ?? botRow.nickname })
        .eq('user_id', tgId)
      console.log(`Updated bot row user_id=${tgId} → uuid=${webUuid} balance=${finalBalance}`)

      // Удаляем сайтовую строку (она теперь перенесена в бот-строку)
      if (webRow && webRow.user_id !== tgId) {
        await (supabase.from('users') as any)
          .delete()
          .eq('user_id', webRow.user_id)
        console.log(`Deleted web row user_id=${webRow.user_id}`)
      }

      await bot.sendMessage(chatId,
        `✅ <b>Аккаунты объединены!</b>\n\nБаланс: <b>${finalBalance} ₮</b>\nНикнейм: <b>${esc(webRow?.nickname ?? botRow.nickname ?? '—')}</b>\n\n🏰 Сайт и бот — одно целое!`,
        { parse_mode: 'HTML', reply_markup: kb }
      )
    } else {
      // Бот-строки нет — просто помечаем сайтовую строку как привязанную
      await (supabase.from('users') as any)
        .update({ balance: finalBalance })
        .eq('uuid', webUuid)
      console.log(`No bot row, just updated web row uuid=${webUuid} balance=${finalBalance}`)

      await bot.sendMessage(chatId,
        `✅ <b>Telegram привязан!</b>\n\nНикнейм: <b>${esc(webRow?.nickname ?? '—')}</b>\nБаланс: <b>${finalBalance} ₮</b>\n\n🏰 Теперь сайт и бот синхронизированы!`,
        { parse_mode: 'HTML', reply_markup: kb }
      )
    }
  } catch (err) {
    console.error('Verification error:', err)
    await bot.sendMessage(chatId, '⚠️ Произошла ошибка. Попробуй позже.', { parse_mode: 'HTML' })
  }
})

// ── Прочие сообщения ──────────────────────────────────────────
bot.on('message', (msg) => {
  const t = msg.text ?? ''
  if (t.startsWith('/') || /^[🔗💰📦]/.test(t) || /^\d{6}$/.test(t)) return
  bot.sendMessage(msg.chat.id, '👆 Используй кнопки меню или отправь 6-значный код.', { reply_markup: kb })
})

console.log('🤖 Verificator bot started')
process.on('uncaughtException', e => console.error('Uncaught:', e))
process.on('unhandledRejection', e => console.error('Unhandled:', e))
