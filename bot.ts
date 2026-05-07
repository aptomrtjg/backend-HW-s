import { Bot, Context, session, type SessionFlavor, InlineKeyboard } from "grammy";
import {
  type Conversation,
  type ConversationFlavor,
  conversations,
  createConversation,
} from "@grammyjs/conversations";
import * as dotenv from "dotenv";
import db, { initDB } from "./database/db";

dotenv.config();

// Ініціалізація БД
initDB();

interface SessionData {}
type MyContext = Context & SessionFlavor<SessionData> & ConversationFlavor<any>;
type MyConversation = Conversation<MyContext>;

const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) {
    console.error("❌ BOT_TOKEN не знайдено в .env");
    process.exit(1);
}

const bot = new Bot<MyContext>(BOT_TOKEN);

const ACTIVITY_FACTORS = {
  low: 1.2,
  light: 1.375,
  medium: 1.55,
  high: 1.725,
};

const ACTIVITY_LABELS: Record<string, string> = {
  low: "Низька (сидяча робота)",
  light: "Легка (вправи 1-3 рази/тиждень)",
  medium: "Середня (вправи 3-5 разів/тиждень)",
  high: "Висока (щоденні тренування)",
};

// --- Формули ---
function calculateBMR(weight: number, height: number, age: number, sex: string): number {
  if (sex === "male") {
    return 10 * weight + 6.25 * height - 5 * age + 5;
  } else {
    return 10 * weight + 6.25 * height - 5 * age - 161;
  }
}

function calculateTDEE(bmr: number, activity: string): number {
  const factor = ACTIVITY_FACTORS[activity as keyof typeof ACTIVITY_FACTORS] || 1.2;
  return bmr * factor;
}

// --- Conversations ---

async function setProfileConversation(conversation: MyConversation, ctx: MyContext) {
  try {
    await ctx.reply("1️⃣ Введіть ваш вік:");
    const age = await conversation.form.number((ctx) => ctx.reply("❌ Введіть число:"));

    await ctx.reply("2️⃣ Введіть ваш зріст у см:");
    const height = await conversation.form.number((ctx) => ctx.reply("❌ Введіть число:"));

    await ctx.reply("3️⃣ Введіть вашу вагу у кг:");
    const weight = await conversation.form.number((ctx) => ctx.reply("❌ Введіть число:"));

    const sexKeyboard = new InlineKeyboard()
      .text("Чоловік ♂️", "male")
      .text("Жінка ♀️", "female");
    await ctx.reply("4️⃣ Оберіть вашу стать:", { reply_markup: sexKeyboard });
    const sexCtx = await conversation.waitForCallbackQuery(["male", "female"]);
    const sex = sexCtx.callbackQuery.data;
    await sexCtx.answerCallbackQuery();

    const activityKeyboard = new InlineKeyboard();
    Object.entries(ACTIVITY_LABELS).forEach(([key, label]) => {
      activityKeyboard.text(label, key).row();
    });
    await ctx.reply("5️⃣ Оберіть рівень активності:", { reply_markup: activityKeyboard });
    const activityCtx = await conversation.waitForCallbackQuery(Object.keys(ACTIVITY_FACTORS));
    const activity = activityCtx.callbackQuery.data;
    await activityCtx.answerCallbackQuery();

    const bmr = calculateBMR(weight, height, age, sex);
    const tdee = calculateTDEE(bmr, activity);

    // Збереження в БД
    db.prepare(`
        INSERT OR REPLACE INTO users (telegram_id, age, weight, height, sex, activity_level, bmr, tdee)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(ctx.from?.id, age, weight, height, sex, activity, bmr, tdee);

    await ctx.reply(`✅ Профіль збережено!\n\n` +
      `📊 Результати:\n` +
      `• BMR: ${bmr.toFixed(2)} ккал\n` +
      `• TDEE: ${tdee.toFixed(2)} ккал`);
  } catch (error) {
    console.error(error);
    await ctx.reply("❌ Сталася помилка. Спробуйте ще раз /set_profile");
  }
}

async function addMealConversation(conversation: MyConversation, ctx: MyContext) {
    await ctx.reply("🥦 Що ви сьогодні з'їли?");
    const { message } = await conversation.waitFor("message:text");
    const raw_text = message.text;

    await ctx.reply("🔢 Скільки приблизно калорій?");
    const calories = await conversation.form.number((ctx) => ctx.reply("❌ Введіть число:"));

    await ctx.reply("📝 Додати замітку? (або напишіть 'ні')");
    const { message: noteMsg } = await conversation.waitFor("message:text");
    const notes = noteMsg.text.toLowerCase() === 'ні' ? null : noteMsg.text;

    // Збереження в БД
    db.prepare(`
        INSERT INTO meals (user_id, raw_text, calories_estimated, notes)
        VALUES (?, ?, ?, ?)
    `).run(ctx.from?.id, raw_text, calories, notes);

    await ctx.reply("Прийом їжі збережено ✅");
}

// --- Middlewares ---
bot.use(session({ initial: () => ({}) }));
bot.use(conversations());
bot.use(async (ctx, next) => {
  console.log(`📩 Отримано оновлення: ${ctx.update.update_id} (${ctx.message?.text || "не текст"})`);
  await next();
});
bot.use(createConversation(setProfileConversation, "set_profile"));
bot.use(createConversation(addMealConversation, "add_meal"));

// --- Commands ---
bot.command("start", (ctx) => {
    ctx.reply("Привіт! Я SQLite Калорійний Бот 🍏\n\nКоманди:\n/set_profile - налаштувати профіль\n/add_meal - додати їжу\n/today - перегляд та видалення\n/notes - ваші замітки\n/my_profile - ваш профіль");
});

bot.command("set_profile", async (ctx) => {
  await ctx.conversation.enter("set_profile");
});

bot.command("add_meal", async (ctx) => {
  await ctx.conversation.enter("add_meal");
});

bot.command("my_profile", (ctx) => {
    const userId = ctx.from?.id;
    const user = db.prepare("SELECT * FROM users WHERE telegram_id = ?").get(userId) as any;

    if (!user) {
        return ctx.reply("Профіль не знайдено. Використовуйте /set_profile");
    }

    ctx.reply(`👤 Ваш профіль:\n\n` +
      `• Вік: ${user.age}\n` +
      `• Вага: ${user.weight} кг\n` +
      `• Зріст: ${user.height} см\n` +
      `• Стать: ${user.sex === 'male' ? 'Чоловік' : 'Жінка'}\n` +
      `• Активність: ${ACTIVITY_LABELS[user.activity_level] || user.activity_level}\n\n` +
      `📊 Розрахунки:\n` +
      `• BMR: ${user.bmr.toFixed(2)} ккал\n` +
      `• TDEE: ${user.tdee.toFixed(2)} ккал`);
});

bot.command("today", (ctx) => {
    const userId = ctx.from?.id;
    const meals = db.prepare(`
        SELECT * FROM meals 
        WHERE user_id = ? AND date(timestamp) = date('now', 'localtime')
    `).all(userId) as any[];

    if (meals.length === 0) {
        return ctx.reply("Сьогодні ще немає записаних прийомів їжі. 🍽️");
    }

    let totalCalories = 0;
    ctx.reply("📅 Сьогодні ви зʼїли:");

    meals.forEach((meal) => {
        totalCalories += meal.calories_estimated;
        const time = new Date(meal.timestamp).toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' });
        
        const keyboard = new InlineKeyboard()
            .text("🗑 Видалити", `delete_meal_${meal.id}`);

        ctx.reply(`🔹 ${meal.raw_text}\n🔥 ${meal.calories_estimated} ккал | 🕒 ${time}${meal.notes ? `\n📝 ${meal.notes}` : ""}`, {
            reply_markup: keyboard
        });
    });

    // Окреме повідомлення з підсумком
    setTimeout(() => {
        ctx.reply(`--------------------------\nЗагалом за день: *${totalCalories}* ккал`, { parse_mode: "Markdown" });
    }, 500);
});

// Обробка видалення
bot.callbackQuery(/^delete_meal_(\d+)$/, async (ctx) => {
    const mealId = ctx.match[1];
    const userId = ctx.from?.id;

    // Перевіряємо, чи належить запис користувачу перед видаленням
    const meal = db.prepare("SELECT user_id FROM meals WHERE id = ?").get(mealId) as any;

    if (meal && meal.user_id === userId) {
        db.prepare("DELETE FROM meals WHERE id = ?").run(mealId);
        await ctx.answerCallbackQuery("Видалено! 🗑");
        await ctx.editMessageText("~~ Запис видалено ~~");
    } else {
        await ctx.answerCallbackQuery("Помилка видалення ❌");
    }
});

bot.command("notes", (ctx) => {
    const userId = ctx.from?.id;
    const meals = db.prepare(`
        SELECT notes, raw_text FROM meals 
        WHERE user_id = ? AND date(timestamp) = date('now', 'localtime') AND notes IS NOT NULL
    `).all(userId) as any[];

    if (meals.length === 0) {
        return ctx.reply("Сьогодні немає заміток.");
    }

    let report = "📝 Ваші замітки за сьогодні:\n\n";
    meals.forEach((meal, index) => {
        report += `${index + 1}. ${meal.raw_text}: ${meal.notes}\n`;
    });

    ctx.reply(report);
});

bot.catch((err) => {
  const ctx = err.ctx;
  console.error(`❌ Помилка при обробці оновлення ${ctx.update.update_id}:`);
  console.error(err.error);
});

async function run() {
  try {
    await bot.start({
      onStart: (botInfo) => {
        console.log(`✅ Бот @${botInfo.username} запущено!`);
      },
    });
  } catch (error) {
    console.error("💀 Критична помилка запуску:", error);
  }
}

run();
