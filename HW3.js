"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const grammy_1 = require("grammy");
const conversations_1 = require("@grammyjs/conversations");
const dotenv = __importStar(require("dotenv"));
// Завантажуємо змінні з .env файлу
dotenv.config();
// 2. Константи та Налаштування
const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN || BOT_TOKEN === "ВАШ_НОВИЙ_ТЕЛЕГРАМ_ТОКЕН") {
    console.error("❌ ПОМИЛКА: Токен не знайдено! Будь ласка, додайте ваш BOT_TOKEN у файл .env");
    process.exit(1);
}
const ACTIVITY_FACTORS = {
    low: 1.2,
    light: 1.375,
    medium: 1.55,
    high: 1.725,
};
const ACTIVITY_LABELS = {
    low: "Низька (сидяча робота)",
    light: "Легка (вправи 1-3 рази/тиждень)",
    medium: "Середня (вправи 3-5 разів/тиждень)",
    high: "Висока (щоденні тренування)",
};
// 3. Основна логіка (Формули BMR та TDEE)
function calculateBMR(weight, height, age, sex) {
    if (sex === "male") {
        return 10 * weight + 6.25 * height - 5 * age + 5;
    }
    else {
        return 10 * weight + 6.25 * height - 5 * age - 161;
    }
}
function calculateTDEE(bmr, activity) {
    return bmr * ACTIVITY_FACTORS[activity];
}
// 4. Логіка опитування (/set_profile)
async function setProfileConversation(conversation, ctx) {
    try {
        // --- Вік ---
        await ctx.reply("1️⃣ Введіть ваш вік:");
        const age = await conversation.form.number((ctx) => ctx.reply("❌ Будь ласка, введіть число (вік):"));
        // --- Зріст ---
        await ctx.reply("2️⃣ Введіть ваш зріст у см:");
        const height = await conversation.form.number((ctx) => ctx.reply("❌ Будь ласка, введіть число (зріст):"));
        // --- Вага ---
        await ctx.reply("3️⃣ Введіть вашу вагу у кг:");
        const weight = await conversation.form.number((ctx) => ctx.reply("❌ Будь ласка, введіть число (вага):"));
        // --- Стать ---
        const sexKeyboard = new grammy_1.InlineKeyboard()
            .text("Чоловік ♂️", "male")
            .text("Жінка ♀️", "female");
        await ctx.reply("4️⃣ Оберіть вашу стать:", { reply_markup: sexKeyboard });
        const sexCtx = await conversation.waitForCallbackQuery(["male", "female"], {
            otherwise: (ctx) => ctx.reply("❌ Будь ласка, натисніть на одну з кнопок!"),
        });
        const sex = sexCtx.callbackQuery.data;
        await sexCtx.answerCallbackQuery();
        await sexCtx.editMessageText(`4️⃣ Стать: ${sex === "male" ? "Чоловік ♂️" : "Жінка ♀️"}`);
        // --- Рівень активності ---
        const activityKeyboard = new grammy_1.InlineKeyboard();
        Object.entries(ACTIVITY_LABELS).forEach(([key, label]) => {
            activityKeyboard.text(label, key).row();
        });
        await ctx.reply("5️⃣ Оберіть рівень активності:", { reply_markup: activityKeyboard });
        const activityCtx = await conversation.waitForCallbackQuery(Object.keys(ACTIVITY_FACTORS), {
            otherwise: (ctx) => ctx.reply("❌ Будь ласка, оберіть варіант зі списку!"),
        });
        const activity = activityCtx.callbackQuery.data;
        await activityCtx.answerCallbackQuery();
        await activityCtx.editMessageText(`5️⃣ Активність: ${ACTIVITY_LABELS[activity]}`);
        // Розрахунки
        const bmr = calculateBMR(weight, height, age, sex);
        const tdee = calculateTDEE(bmr, activity);
        // Збереження в сесію
        // Використовуємо conversation.external для прямого доступу до ctx.session
        await conversation.external(() => {
            if (!ctx.session)
                ctx.session = {};
            ctx.session.profile = { age, height, weight, sex, activity, bmr, tdee };
        });
        await ctx.reply(`✅ Профіль налаштовано!\n\n` +
            `📊 Результати:\n` +
            `• BMR: ${bmr.toFixed(2)} ккал\n` +
            `• TDEE: ${tdee.toFixed(2)} ккал\n\n` +
            `Ви можете переглянути свої дані: /my_profile`);
    }
    catch (error) {
        console.error("[CONV] Помилка в опитуванні:", error);
        await ctx.reply("❌ Сталася помилка під час опитування. Спробуйте ще раз: /set_profile");
    }
}
const bot = new grammy_1.Bot(BOT_TOKEN);
// Обробка помилок
bot.catch((err) => {
    console.error(`Error while handling update ${err.ctx.update.update_id}:`);
    console.error(err.error);
});
// Налаштування сесії
bot.use((0, grammy_1.session)({
    initial() {
        return {};
    },
}));
// Плагін розмов
bot.use((0, conversations_1.conversations)());
bot.use((0, conversations_1.createConversation)(setProfileConversation, "set_profile_conv"));
// 6. Команди
bot.command("start", (ctx) => {
    return ctx.reply("Привіт! Я новий бот для підрахунку калорій 🍏\n\nНатисніть /set_profile, щоб почати.");
});
bot.command("set_profile", async (ctx) => {
    await ctx.conversation.enter("set_profile_conv");
});
bot.command("my_profile", (ctx) => {
    const p = ctx.session.profile;
    if (!p)
        return ctx.reply("⚠️ Профіль порожній. Використайте /set_profile.");
    return ctx.reply(`🗂 Ваш профіль:\n` +
        `• Вік: ${p.age}\n` +
        `• Зріст: ${p.height} см\n` +
        `• Вага: ${p.weight} кг\n` +
        `• Стать: ${p.sex === "male" ? "Чоловік ♂️" : "Жінка ♀️"}\n` +
        `• Активність: ${ACTIVITY_LABELS[p.activity] || p.activity}\n` +
        `--------------------------\n` +
        `• BMR: ${p.bmr.toFixed(2)} ккал\n` +
        `• TDEE: ${p.tdee.toFixed(2)} ккал`);
});
bot.command("help", (ctx) => {
    return ctx.reply("Команди: /start, /set_profile, /my_profile, /help");
});
// 7. Запуск
console.log("Новий калорійний бот запускається...");
bot.start().catch(console.error);
