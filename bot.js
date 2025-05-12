const TelegramBot = require('node-telegram-bot-api');
const ExcelJS = require('exceljs');
const fs = require('fs');
const { getHelpText } = require('./help'); 

const token = '7481905223:AAGnXPseVq0zm4ej879zvzzReqqs6gqC3bg'; 
const bot = new TelegramBot(token, { polling: true });

let userStates = {}; 
const CLEAR_PASSWORD = 'ad105171';
let clearCacheRequests = {}; // Parol kutish holatini saqlovchi obyekt

function loadData(chatId) {
  try {
    return JSON.parse(fs.readFileSync(`data_${chatId}.json`, 'utf8'));
  } catch (err) {
    return [];
  }
}

function saveData(chatId, data) {
  fs.writeFileSync(`data_${chatId}.json`, JSON.stringify(data, null, 2));
}

bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  const savedData = loadData(chatId);

  userStates[chatId] = {
    step: 'category',
    data: savedData,
  };

  bot.sendMessage(chatId, 'Yangi kategoriyani nomini kiriting (masalan: Haladilnik):');
});

bot.onText(/\/help/, (msg) => {
  const chatId = msg.chat.id;
  const helpText = getHelpText(); 
  bot.sendMessage(chatId, helpText);
});

bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text?.trim();

  // Kesh tozalash buyruqlari
  if (text?.toLowerCase() === 'kesh') {
    clearCacheRequests[chatId] = true;
    bot.sendMessage(chatId, '🔐 Keshni tozalash uchun parolni kiriting:');
    return;
  }

  if (clearCacheRequests[chatId]) {
    if (text === CLEAR_PASSWORD) {
      const filePath = `data_${chatId}.json`;
      try {
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
        delete userStates[chatId];
        bot.sendMessage(chatId, '✅ Kesh muvaffaqiyatli tozalandi!');
      } catch (err) {
        bot.sendMessage(chatId, '❌ Keshni tozalashda xatolik yuz berdi.');
      }
    } else {
      bot.sendMessage(chatId, '❗️ Noto‘g‘ri parol.');
    }
    delete clearCacheRequests[chatId];
    return;
  }

  // Agar hali state boshlanmagan yoki bu buyruq bo‘lsa
  if (!userStates[chatId] || text.startsWith('/')) return;
  const state = userStates[chatId];

  if (text.toLowerCase() === 'keyingi') {
    state.step = 'category';
    bot.sendMessage(chatId, 'Yangi kategoriyani kiriting:');
    return;
  }

  if (text.toLowerCase() === 'tamom') {
    const filePath = await generateExcel(state.data, chatId);
    bot.sendDocument(chatId, filePath).then(() => {
      fs.unlinkSync(filePath);
    });
    return;
  }

  if (text.toLowerCase() === 'qayta') {
    state.step = 'edit_code';
    bot.sendMessage(chatId, `Qaysi tovarni o‘zgartirmoqchisiz? Kodini kiriting:`);
    return;
  }

  if (text.toLowerCase() === 'sotilgan') {
    state.step = 'mark_sold';
    bot.sendMessage(chatId, 'Qaysi tovar kodini "sotilgan" deb belgilamoqchisiz?');
    return;
  }

  if (state.step === 'mark_sold') {
    const index = state.data.findIndex(item => item.code === text);
    if (index !== -1) {
      state.data[index].status = 'sotilgan';
      saveData(chatId, state.data);
      bot.sendMessage(chatId, `Kod "${text}" bo‘yicha mahsulot "sotilgan" deb belgilandi.`);
    } else {
      bot.sendMessage(chatId, `Kod "${text}" topilmadi.`);
    }
    state.step = 'category';
    return;
  }

  if (state.step === 'edit_code') {
    const index = state.data.findIndex(item => item.code === text);
    if (index === -1) {
      bot.sendMessage(chatId, 'Bu kod bo‘yicha tovar topilmadi.');
      return;
    }
    state.editIndex = index;
    state.tempItem = { ...state.data[index] };
    state.step = 'edit_name';
    bot.sendMessage(chatId, 'Yangi tovar nomini kiriting:');
    return;
  }

  if (state.step === 'edit_name') {
    state.tempItem.name = text;
    state.step = 'edit_new_code';
    bot.sendMessage(chatId, 'Yangi tovar kodini kiriting:');
    return;
  }

  if (state.step === 'edit_new_code') {
    state.tempItem.code = text;
    state.step = 'edit_model';
    bot.sendMessage(chatId, 'Yangi modelini kiriting:');
    return;
  }

  if (state.step === 'edit_model') {
    state.tempItem.model = text;
    state.data[state.editIndex] = state.tempItem;
    saveData(chatId, state.data);
    delete state.editIndex;
    state.tempItem = {};
    state.step = 'name';
    bot.sendMessage(chatId, 'Tovar yangilandi! Endi yangi mahsulot nomini kiriting yoki "keyingi", "tamom", "qayta", "sotilgan" deb yozing:');
    return;
  }

  switch (state.step) {
    case 'category':
      state.currentCategory = text;
      state.tempItem = {};
      state.step = 'name';
      bot.sendMessage(chatId, `Mahsulot nomini kiriting (${text}):`);
      break;
    case 'name':
      state.tempItem.name = text;
      state.step = 'code';
      bot.sendMessage(chatId, 'Mahsulot kodini kiriting:');
      break;
    case 'code':
      state.tempItem.code = text;
      state.step = 'model';
      bot.sendMessage(chatId, 'Mahsulot modelini kiriting:');
      break;
    case 'model':
      state.tempItem.model = text;
      state.tempItem.status = 'aktiv'; 
      state.data.push({
        category: state.currentCategory,
        ...state.tempItem,
      });
      saveData(chatId, state.data);
      state.tempItem = {};
      state.step = 'name';
      bot.sendMessage(chatId, 'Yana bir mahsulot nomini kiriting yoki "keyingi", "tamom", "qayta", "sotilgan" deb yozing:');
      break;
  }
});

async function generateExcel(data, userId) {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Tovarlar');

  worksheet.columns = [
    { header: 'Kategoriya', key: 'category' },
    { header: 'Nomi', key: 'name' },
    { header: 'Kodi', key: 'code' },
    { header: 'Modeli', key: 'model' },
    { header: 'Holati', key: 'status' },
  ];

  data.forEach((item) => {
    worksheet.addRow(item);
  });

  const filePath = `./tovarlar_${userId}.xlsx`;
  await workbook.xlsx.writeFile(filePath);
  return filePath;
}

console.log('Bot ishga tushdi...');
