import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import {
  Bot,
  Context,
  webhookCallback,
} from "https://deno.land/x/grammy@v1.8.3/mod.ts";
import {
  clearUserMessageHistory,
  estimateTokens,
  formatMessageHistory,
  getAiResponse,
  getCredits,
  getUserId,
  getUserMessageHistory,
  Message,
  updateUserMessageHistory,
} from "./utils.ts";

const users: string[] = JSON.parse(Deno.env.get("USERS") || "[]");

/*The script starts by defining two variables: users and botToken.

The users variable is an array of strings that contains the Telegram usernames of the users who are authorized to access the bot. This array is initialized by parsing a JSON string retrieved from an environment variable named USERS. If the USERS environment variable is not defined, the array is initialized to an empty array.

The botToken variable is a string that contains the API token of the Telegram bot. This variable is initialized by retrieving a string value from an environment variable named BOT_TOKEN. If the BOT_TOKEN environment variable is not defined, an empty string is used as a fallback value.
*/
const botToken = Deno.env.get("BOT_TOKEN") || "";

if (!botToken) {
  throw new Error(`Please specify the Telegram Bot Token.`);
}

/* Next, the script checks whether the botToken variable is truthy (i.e., not empty or undefined). If botToken is falsy, the script throws an error with the message "Please specify the Telegram Bot Token."
*/

if (!users.length) {
  throw new Error(`Please specify the users that have access to the bot.`);
}

/* Similarly, the script checks whether the users array is not empty. If the users array is empty, the script throws an error with the message "Please specify the users that have access to the bot."
*/

/*Finally, the script defines a custom type BotContext that extends the Context type from the grammy library. The BotContext type includes an additional property named config, which is an object with a single boolean property named isOwner. This BotContext type will be used later to provide additional context to bot handlers.
*/

const bot = new Bot<BotContext>(botToken);

type BotContext = Context & {
  config: {
    isOwner: boolean;
  };
};

/*Lastly, an instance of the Bot class is created using the botToken. The Bot class is a class provided by the grammy library and is used to create and manage a Telegram bot instance. The Bot instance is stored in the bot variable.
*/

bot.use(async (ctx, next) => {
  ctx.config = {
    isOwner: users.some((user) => ctx.from?.username === user),
  };

  if (!ctx.config.isOwner) {
    return ctx.reply(`Sorry, you are not allowed. This is personal AI Bot`);
  }

  await next();
});

bot.command("start", (ctx) =>
  ctx.reply("Welcome! I will be your personal AI Assistant.")
);

bot.command("credits", async (ctx) => {
  const { total_available, total_used } = await getCredits();
  await ctx
    .reply(
      `Here is your total <strong>OpenAI</strong> usage amount:\nUsed balance: <strong>${total_used}</strong>\nAvailable balance: <strong>${total_available}</strong>`,
      {
        parse_mode: "HTML",
      }
    )
    .catch((e) => console.error(e));
});

bot.command("ping", (ctx) => ctx.reply(`Pong! ${new Date()} ${Date.now()}`));

bot.command("history", async (ctx) => {
  const userId = getUserId(ctx);
  if (!userId) return ctx.reply(`No User Found`);

  const history = await getUserMessageHistory(userId);
  const aprxTokens = estimateTokens(
    formatMessageHistory(history).replaceAll("\n", "")
  );
  console.log(formatMessageHistory(history).replaceAll("\n", ""));

  const reply = formatMessageHistory(history.filter((m) => m.role !== "system"))
    ? formatMessageHistory(history.filter((m) => m.role !== "system")) +
      `Approximate token usage for your query: ${aprxTokens}`
    : "History is empty";

  return ctx.reply(reply, {});
});

bot.errorBoundary((err) => {
  console.error(err);
});

bot.command("clear", async (ctx) => {
  const userId = getUserId(ctx);

  if (!userId) {
    return ctx.reply(`No User Found`);
  }

  await clearUserMessageHistory(userId);

  return ctx.reply(`Your dialogue has been cleared`);
});

bot.on("message", async (ctx) => {
  try {
    const userId = ctx?.from?.id;
    const receivedMessage = ctx.update.message.text;

    if (!receivedMessage) {
      ctx.reply(`No message`);
    }

    const history = await getUserMessageHistory(userId);

    const aprxTokens = estimateTokens(formatMessageHistory(history));

    if (aprxTokens > 2000) {
      await ctx.reply(
        `Just a heads up, you've used around *${Math.floor(
          +aprxTokens
        )}* tokens for this query. To help you manage your token usage, we recommend running the */clear* command every so oftens usage.`,
        {
          parse_mode: "Markdown",
        }
      );
    }

    const message: Message = {
      role: "user",
      content: receivedMessage || "",
    };

    const aiResponse = await getAiResponse([...history, message]);

    await updateUserMessageHistory(userId, [
      ...history,
      message,
      { role: "assistant", content: aiResponse + "\n" },
    ]);

    await ctx.reply(aiResponse).catch((e) => console.error(e));
  } catch (error) {
    console.error(error);
    ctx.reply(`Sorry an error has occured, please try again later.`);
  }
});

await bot.api.setMyCommands([
  {
    command: "/start",
    description: "Start the bot",
  },
  {
    command: "/clear",
    description: "Clear the dialogue history.",
  },
  {
    command: "/history",
    description: "Show the dialogue history.",
  },
  {
    command: "/credits",
    description: "Show the amount of credits used.",
  },
]);

const handleUpdate = webhookCallback(bot, "std/http", "throw", 40_000);

serve(async (req) => {
  try {
    const url = new URL(req.url);
    const isAllowed =
      url.searchParams.get("secret") === Deno.env.get("FUNCTION_SECRET");

    if (!isAllowed) {
      return new Response("not allowed", { status: 405 });
    }

    return await handleUpdate(req);
  } catch (err) {
    console.error(err);
  }
});
