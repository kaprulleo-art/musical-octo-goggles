import dotenv from 'dotenv';
dotenv.config();

import fetch from 'node-fetch';
import { Telegraf, Markup } from 'telegraf';

import http from 'http';
http.createServer((req, res) => res.end('Bot is running')).listen(process.env.PORT || 3000);

const BOT_TOKEN = process.env.BOT_TOKEN;
const JSONBIN_USERS_BIN_ID = process.env.JSONBIN_USERS_BIN_ID;
const JSONBIN_ADMINS_BIN_ID = process.env.JSONBIN_ADMINS_BIN_ID;
const JSONBIN_API_KEY = process.env.JSONBIN_API_KEY;
const SUPPORT_CHAT_ID = Number(process.env.SUPPORT_CHAT_ID);

if (!BOT_TOKEN) {
  console.error('ERROR: BOT_TOKEN не задан в .env');
  process.exit(1);
}
if (!JSONBIN_USERS_BIN_ID || !JSONBIN_API_KEY) {
  console.error('ERROR: JSONBIN_USERS_BIN_ID или JSONBIN_API_KEY не заданы в .env');
  process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);

async function loadUsers() {
  try {
    const res = await fetch(`https://api.jsonbin.io/v3/b/${JSONBIN_USERS_BIN_ID}/latest`, {
      headers: { 'X-Master-Key': JSONBIN_API_KEY }
    });
    if (!res.ok) throw new Error(`JSONBin load users failed: ${res.status}`);
    const json = await res.json();
    return json.record && Array.isArray(json.record.users) ? json.record : { users: [] };
  } catch (err) {
    console.error('loadUsers error:', err.message);
    return { users: [] };
  }
}

async function saveUsers(data) {
  try {
    const res = await fetch(`https://api.jsonbin.io/v3/b/${JSONBIN_USERS_BIN_ID}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'X-Master-Key': JSONBIN_API_KEY
      },
      body: JSON.stringify(data, null, 2)
    });
    if (!res.ok) {
      const txt = await res.text();
      console.error('saveUsers error:', res.status, txt);
    }
  } catch (err) {
    console.error('saveUsers exception:', err.message);
  }
}

async function loadAdmins() {
  try {
    const res = await fetch(`https://api.jsonbin.io/v3/b/${JSONBIN_ADMINS_BIN_ID}/latest`, {
      headers: { 'X-Master-Key': JSONBIN_API_KEY }
    });
    if (!res.ok) throw new Error(`JSONBin load admins failed: ${res.status}`);
    const json = await res.json();
    return json.record && Array.isArray(json.record.admins) ? json.record.admins : [];
  } catch (err) {
    console.error('loadAdmins error:', err.message);
    return [];
  }
}

// ---------------------- Вспомогательные функции ----------------------
function generateUniqueKey(length = 12) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let key = '';
  for (let i = 0; i < length; i++) key += chars.charAt(Math.floor(Math.random() * chars.length));
  return key;
}

function displayUserName(u) {
  if (!u) return '';
  if (u.username) return `@${u.username}`;
  if (u.first_name && u.last_name) return `${u.first_name} ${u.last_name}`;
  return u.first_name || (u.last_name ? u.last_name : `id${u.id}`);
}

// ---------------------- Сессии поддержки ----------------------
const supportSessions = new Map(); // userId -> session
const supportTickets = new Map();   // groupMessageId -> ticket

// ---------------------- /start ----------------------
bot.start(async (ctx) => {
  const tgId = ctx.from.id;

  const data = await loadUsers();
  let user = data.users.find(u => u.id === tgId);
  if (!user) {
    const key = generateUniqueKey();
    user = {
      id: tgId,
      login: ctx.from.username || '',
      key,
      hwid: null,
      buy1: { days: 0, start: null },
      buy2: { days: 0, start: null }
    };
    data.users.push(user);
    await saveUsers(data);
  }

  // закрываем старую сессию (если была)
  supportSessions.delete(tgId);

  return ctx.reply(
    'Вас приветствует команда MR',
    Markup.inlineKeyboard([
      [ Markup.button.url('Открыть приложения', 'https://rogers1234556.github.io/Modele-/') ],
      [ Markup.button.url('Наш канал', 'https://t.me/mr') ],
      [ Markup.button.callback('Написать в поддержку', 'open_support') ],
    ])
  );
});

// ---------------------- Нажатие "Написать в поддержку" ----------------------
bot.action('open_support', async (ctx) => {
  try { await ctx.answerCbQuery(); } catch {}
  return ctx.reply(
    'Выберите тему обращения',
    Markup.inlineKeyboard([
      [ Markup.button.callback('Оплата товара', 'topic_payment') ],
      [ Markup.button.callback('Проблемы с Helper’ом', 'topic_helper') ],
      [ Markup.button.callback('Предложения по улучшению', 'topic_suggest') ],
      [ Markup.button.callback('Другое', 'topic_other') ]
    ])
  );
});

// ---------------------- Выбор темы ----------------------
bot.action(/topic_(.+)/, async (ctx) => {
  try { await ctx.answerCbQuery(); } catch {}

  const topicKey = ctx.match[1];
  const userId = ctx.from.id;
  const displayName = displayUserName(ctx.from);

  const session = {
    userId,
    topic: topicKey,
    active: false,
    awaitingMessage: false,
    supportMsgIdInGroup: null,
    displayName
  };

  supportSessions.set(userId, session);

  const endKeyboard = Markup.keyboard([['Закончить общение']]).resize();

  if (topicKey === 'payment') {
    await ctx.reply('Скоро с вами свяжется администратор, как освободится.', endKeyboard);

    const textForGroup =
      `• Оплата товара\n` +
      `• ${displayName} | ID: ${userId}\n` +
      `~ —\n` +
      `- Не ответили`;

    const sent = await bot.telegram.sendMessage(SUPPORT_CHAT_ID, textForGroup);

    supportTickets.set(sent.message_id, {
      userId,
      topic: 'Оплата товара',
      displayName,
      text: '—',
      status: 'Не ответили',
      groupMsgId: sent.message_id
    });

    session.active = true;
    session.supportMsgIdInGroup = sent.message_id;
    supportSessions.set(userId, session);

    return;
  }

  session.awaitingMessage = true;
  supportSessions.set(userId, session);

  let prompt = '';
  if (topicKey === 'helper') prompt = 'Пожалуйста опишите вашу проблему, и с вами свяжется администратор.';
  if (topicKey === 'suggest') prompt = 'Пожалуйста напишите ваше предложение, и с вами свяжется разработчик.';
  if (topicKey === 'other') prompt = 'Пожалуйста опишите вашу ситуацию, и с вами свяжется администратор/разработчик.';

  await ctx.reply(prompt, endKeyboard);
});

bot.on('message', async (ctx) => {

  if (ctx.chat && ctx.chat.type === 'private') {
      return handlePrivateMessage(ctx);
  }

  if (ctx.chat && ctx.chat.id === SUPPORT_CHAT_ID) {
      return handleAdminReply(ctx);  // ← ошибка была тут
  }

});

async function handlePrivateMessage(ctx) {
  const userId = ctx.from.id;
  const text = ctx.message.text || '';
  const session = supportSessions.get(userId);

  if (!session) return;

  if (text === 'Закончить общение') {
      supportSessions.delete(userId);

    await ctx.reply('Общение завершено.\n Используйте /start', Markup.removeKeyboard());

      return;
  }

  // PAYMENT — первый тикет без сообщения
  if (session.topic === 'payment' && session.active === false) {
    await ctx.reply(
      'Сообщение уже отправлено в поддержку. Ожидайте ответа администратора.',
      Markup.keyboard([['Закончить общение']]).resize()
    );
    return;
  }

  // Первое сообщение пользователя
  if (session.awaitingMessage) {
    session.awaitingMessage = false;
    session.active = true;

    const topicText =
      session.topic === 'helper' ? 'Проблема с Helper’ом' :
      session.topic === 'suggest' ? 'Предложения по улучшению' :
      'Другое';

    const sentMsg = await bot.telegram.sendMessage(
      SUPPORT_CHAT_ID,
      `• ${topicText}\n• ${session.displayName} | ID: ${userId}\n- ${text}\n• Не ответили`
    );

    supportTickets.set(sentMsg.message_id, {
      userId,
      topic: topicText,
      displayName: session.displayName,
      text,
      status: 'Не ответили',
      groupMsgId: sentMsg.message_id
    });

    session.supportMsgIdInGroup = sentMsg.message_id;
    supportSessions.set(userId, session);

    await ctx.reply(
      'Ваше сообщение отправлено в поддержку. Ожидайте ответа.',
      Markup.keyboard([['Закончить общение']]).resize()
    );

    return;
  }

  if (session.active) {
      const body = ctx.message.text || '[медиа сообщение]';

      
      const topicText =
          session.topic === 'payment' ? 'Оплата товара' :
          session.topic === 'helper' ? 'Проблема с Helper’ом' :
          session.topic === 'suggest' ? 'Предложение' :
          'Другое';

      
      const sent = await bot.telegram.sendMessage(
          SUPPORT_CHAT_ID,
          `• ${topicText} \n• ${session.displayName} | ID: ${userId}\n- ${body}\n• Не ответили`,
          { reply_to_message_id: session.supportMsgIdInGroup } 
      );

      // Обновляем ID последнего сообщения для связи
      session.supportMsgIdInGroup = sent.message_id;
      supportSessions.set(userId, session);

      // Создаём новый тикет
      supportTickets.set(sent.message_id, {
          userId,
          topic: topicText,
          displayName: session.displayName,
          text: body,
          status: 'Не ответили',
          groupMsgId: sent.message_id
      });

      await ctx.reply(
          'Ваше сообщение отправлено в поддержку. Ожидайте ответа.',
          Markup.keyboard([['Закончить общение']]).resize()
      );
  }
}

async function handleAdminReply(ctx) {
  const msg = ctx.message;

  if (!msg.reply_to_message) return;

  const ticket = supportTickets.get(msg.reply_to_message.message_id);
  if (!ticket) return;

  // Загружаем админов
  const admins = await loadAdmins();

  // Ищем администратора, который ответил
  const admin = admins.find(a => a.id === msg.from.id);
  if (!admin) return; // если не админ — игнорируем

  const adminName = admin.nickname || 'Администратор';
  const replyText = msg.text || msg.caption || '[медиа сообщение]';

  // Отправляем пользователю ответ
  await bot.telegram.sendMessage(
    ticket.userId,
    `• ${adminName} :\n${replyText}`,
    {
      reply_markup: Markup.keyboard([['Закончить общение']]).resize().reply_markup
    }
  );

  // Обновляем статус тикета
  ticket.status = 'Ответили';
  supportTickets.set(ticket.groupMsgId, ticket);

  // Обновляем сообщение в группе
  try {
    await bot.telegram.editMessageText(
      SUPPORT_CHAT_ID,
      ticket.groupMsgId,
      null,
      `• ${ticket.topic}\n• ${ticket.displayName} | ID: ${ticket.userId}\n- ${ticket.text}\n• Ответил: ${adminName}`
    );
  } catch (err) {}
}


bot.launch();