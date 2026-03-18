import TelegramBot from 'node-telegram-bot-api'
import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
dotenv.config()

// ── Config ────────────────────────────────────────────────────
const BOT_TOKEN    = process.env.BOT_TOKEN!
const SUPABASE_URL = process.env.SUPABASE_URL!
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!
const REDIS_URL    = process.env.UPSTASH_REDIS_REST_URL!
const REDIS_TOKEN  = process.env.UPSTASH_REDIS_REST_TOKEN!

const bot      = new TelegramBot(BOT_TOKEN, { polling: true })
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

// ── Upstash Redis helpers ─────────────────────────────────────
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

// ── Supabase helpers ──────────────────────────────────────────
function escapeHtml(text: string) {
  return String(text).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
}

async function findUserByTgId(tgId: number) {
  const { data } = await (supabase.from('users') as any)
    .select('user_id, uuid, balance, nickname')
    .eq('referal', tgId)
    .maybeSingle()
  return data as { user_id: number; uuid: string; balance: number; nickname: string } | null
}

async function findUserByUuid(uuid: string) {
  const { data } = await (supabase.from('users') as any)
    .select('user_id, uuid, balance, nickname')
    .eq('uuid', uuid)
    .maybeSingle()
  return data as { user_id: number; uuid: string; balance: number; nickname: string } | null
}

// ── Keyboard ──────────────────────────────────────────────────
const mainKeyboard = {
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
  const name   = escapeHtml(msg.from!.first_name ?? 'Путник')

  const existing = await findUserByTgId(tgId)

  const text = existing
    ? `👋 С возвращением, <b>${name}</b>!\n\n🏰 Твой аккаунт уже привязан к сайту.\n\nНикнейм: <b>${escapeHtml(existing.nickname ?? '—')}</b>\nБаланс: <b>${existing.balance ?? 0} ₮</b>\n\nЧтобы привязать другой аккаунт — нажми <b>🔗 Привязать аккаунт</b>.`
    : `👋 Добро пожаловать, <b>${name}</b>!\n\n🏰 <b>Тридевятое Царство</b>\nВерификационный бот\n\n━━━━━━━━━━━━━━━\n\nДля привязки аккаунта сайта к Telegram:\n\n<b>1.</b> Зайди на сайт → Профиль\n<b>2.</b> Нажми <b>«Привязать Telegram»</b>\n<b>3.</b> Получи 6-значный код\n<b>4.</b> Отправь его сюда\n\n📌 Это объединит баланс, заказы и историю сайта и бота в одно.`

  await bot.sendMessage(chatId, text, { parse_mode: 'HTML', reply_markup: mainKeyboard })
})

// ── Привязать аккаунт ─────────────────────────────────────────
bot.onText(/🔗 Привязать аккаунт/, async (msg) => {
  await bot.sendMessage(msg.chat.id,
    `🔑 <b>Привязка аккаунта</b>\n\n━━━━━━━━━━━━━━━\n\n<b>Шаг 1.</b> Открой <b>farkgdm.shop</b>\n<b>Шаг 2.</b> Зайди в <b>Профиль</b>\n<b>Шаг 3.</b> Нажми кнопку <b>«Привязать Telegram»</b>\n<b>Шаг 4.</b> Скопируй 6-значный код\n<b>Шаг 5.</b> Отправь его в этот чат\n\n━━━━━━━━━━━━━━━\n⏱ Код действует <b>10 минут</b>`,
    { parse_mode: 'HTML' }
  )
})

// ── Баланс ────────────────────────────────────────────────────
bot.onText(/💰 Мой баланс/, async (msg) => {
  const user = await findUserByTgId(msg.from!.id)
  if (!user) {
    await bot.sendMessage(msg.chat.id,
      '❌ Аккаунт не привязан.\n\nНажми <b>🔗 Привязать аккаунт</b>.',
      { parse_mode: 'HTML', reply_markup: mainKeyboard }
    )
    return
  }
  await bot.sendMessage(msg.chat.id,
    `💰 <b>Баланс</b>\n\n<b>${user.balance ?? 0} ₮</b> USDT\n\nНикнейм: ${escapeHtml(user.nickname ?? '—')}`,
    { parse_mode: 'HTML', reply_markup: mainKeyboard }
  )
})

// ── Мои заказы ────────────────────────────────────────────────
bot.onText(/📦 Мои заказы/, async (msg) => {
  const user = await findUserByTgId(msg.from!.id)
  if (!user) {
    await bot.sendMessage(msg.chat.id,
      '❌ Аккаунт не привязан.\n\nНажми <b>🔗 Привязать аккаунт</b>.',
      { parse_mode: 'HTML', reply_markup: mainKeyboard }
    )
    return
  }

  const { data: orders } = await (supabase.from('transaction') as any)
    .select('id_transaction, name_of_stuff, amount, city, time_created, not_found')
    .eq('uuid_user', user.uuid)
    .order('time_created', { ascending: false })
    .limit(5)

  if (!orders || orders.length === 0) {
    await bot.sendMessage(msg.chat.id, '📦 Заказов пока нет.', { reply_markup: mainKeyboard })
    return
  }

  const lines = orders.map((o: any) => {
    const date   = new Date(o.time_created).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })
    const status = (Number(o.not_found ?? 0) > 0) ? '⚠️' : '✅'
    return `${status} <b>${escapeHtml(o.name_of_stuff ?? '—')}</b>\n   ${o.amount ?? 0}€ · ${escapeHtml(o.city ?? '—')} · ${date}`
  }).join('\n\n')

  await bot.sendMessage(msg.chat.id,
    `📦 <b>Последние заказы</b>\n\n${lines}`,
    { parse_mode: 'HTML', reply_markup: mainKeyboard }
  )
})

// ── 6-значный код ─────────────────────────────────────────────
bot.onText(/^(\d{6})$/, async (msg, match) => {
  const chatId = msg.chat.id
  const tgId   = msg.from!.id
  const code   = match![1]!

  const webUuid = await redisGet(`verify:${code}`)
  if (!webUuid) {
    await bot.sendMessage(chatId,
      '❌ <b>Код не найден или истёк</b>\n\nЗапроси новый код в профиле на сайте.\nКод действует 10 минут.',
      { parse_mode: 'HTML' }
    )
    return
  }

  // Удаляем одноразовый код
  await redisDel(`verify:${code}`)

  try {
    const webUser    = await findUserByUuid(webUuid)
    const existingTg = await findUserByTgId(tgId)

    // Считаем финальный баланс = MAX(bot_balance, web_balance)
    const botBalance = Number(existingTg?.balance ?? 0)
    const webBalance = Number(webUser?.balance ?? 0)
    const finalBalance = Math.max(botBalance, webBalance)

    console.log(`Merge: botBalance=${botBalance}, webBalance=${webBalance}, final=${finalBalance}, sameUuid=${existingTg?.uuid === webUuid}`)

    if (existingTg && existingTg.uuid !== webUuid) {
      // Переносим транзакции со старого uuid на новый
      const { error: txErr } = await (supabase.from('transaction') as any)
        .update({ uuid_user: webUuid })
        .eq('uuid_user', existingTg.uuid)
      if (txErr) console.error('TX transfer error:', txErr)

      // Удаляем старую строку бота
      const { error: delErr } = await (supabase.from('users') as any)
        .delete()
        .eq('uuid', existingTg.uuid)
      if (delErr) console.error('Delete old user error:', delErr)
    }

    // Обновляем web-аккаунт: пишем tg_id и МАКСИМАЛЬНЫЙ баланс
    const { error: updErr } = await (supabase.from('users') as any)
      .update({ referal: tgId, balance: finalBalance })
      .eq('uuid', webUuid)
    if (updErr) console.error('Update web user error:', updErr)

    const nickname = escapeHtml(webUser?.nickname ?? '—')
    const mergedMsg = existingTg && existingTg.uuid !== webUuid
      ? `✅ <b>Аккаунты объединены!</b>\n\nТранзакции перенесены.\nБаланс объединён: <b>${finalBalance} ₮</b>`
      : `✅ <b>Telegram привязан!</b>\n\nНикнейм: <b>${nickname}</b>\nБаланс: <b>${finalBalance} ₮</b>`

    await bot.sendMessage(chatId,
      `${mergedMsg}\n\n🏰 Теперь сайт и бот — одно целое!\nЗаказы, баланс и история синхронизированы.`,
      { parse_mode: 'HTML', reply_markup: mainKeyboard }
    )
  } catch (err) {
    console.error('Verification error:', err)
    await bot.sendMessage(chatId,
      '⚠️ Произошла ошибка. Попробуй позже или обратись к оператору.',
      { parse_mode: 'HTML' }
    )
  }
})

// ── Прочие сообщения ──────────────────────────────────────────
bot.on('message', (msg) => {
  const text = msg.text ?? ''
  if (text.startsWith('/') || /^[🔗💰📦]/.test(text) || /^\d{6}$/.test(text)) return
  bot.sendMessage(msg.chat.id,
    '👆 Используй кнопки меню или отправь 6-значный код.',
    { reply_markup: mainKeyboard }
  )
})

console.log('🤖 Verificator bot started')
process.on('uncaughtException', (e) => console.error('Uncaught:', e))
process.on('unhandledRejection', (e) => console.error('Unhandled:', e))
