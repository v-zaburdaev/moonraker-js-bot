import { Telegraf } from "telegraf";
import { Input } from "telegraf";
import { Printer } from "./printer.js";
import schedule from "node-schedule";

export class Bot {
  config = null;
  bot = null;
  printer = null;
  chats = null;
  admins = null;
  messages = {};
  last_update = 0;
  job_id = null;
  sending_data = false;
  commands = [
    {
      command: "start",
      description: "Bot can send stat in this chat",
    },
    {
      command: "status",
      description: "printer status",
    },
  ];

  constructor(config) {
    this.config = config;
    this.chats = config.chats;
    this.bot = new Telegraf(this.config.bot_token);
    this.printer = new Printer(
      this.config.printer,
      this.printerCallback.bind(this)
    );
    this.job = schedule.scheduleJob(
      this.config.scheduleJobs[0],
      this.cronJob.bind(this)
    );
    this.start();
  }

  async cronJob() {
    const status = this.printer.getStatus();
    if (!status.print_stats.state == "printing") return;
    await this.printerCallback("cron_job", this.printer.getStatus());
  }

  async getStatus() {
    await this.printerCallback("state_change", this.printer.getStatus());
  }

  async printerCallback(event, data) {
    let filename, image, text;
    switch (event) {
      case "start_print":
        filename = data.print_stats.filename;
        if (!this.job_id) {
          this.job_id = Math.round(Math.random(1000) * 1000);
        }

        if (filename) {
          image = await this.printer.getThumbnailImage(filename);
        }
        text = this.printer.getMessageText();
        await this.sendData(text, image, this.job_id);
        break;
      case "pause_print":
        if (!this.job_id) {
          this.job_id = Math.round(Math.random(1000) * 1000);
        }
        image = await this.printer.getImage();
        text = this.printer.getMessageText();
        await this.sendData("Paused\n" + text, image, this.job_id);
        break;
      case "cancel_print":
        image = await this.printer.getImage();
        text = this.printer.getMessageText();
        await this.sendData("Cancelled\n" + text, image, null);
        this.job_id = null;
        this.messages = {};
        break;
      case "error":
        text = this.printer.getMessageText();
        await this.sendData("Error!\n" + text, null, null);
        this.job_id = null;
        this.messages = {};
        break;
      case "state_change":
        if (data.print_stats.state == "printing") {
          if (!this.job_id) {
            this.job_id = Math.round(Math.random(1000) * 1000);
          }
          filename = data.print_stats.filename;
          image = await this.printer.getImage();
        }
        text = this.printer.getMessageText();
        await this.sendData(text, image, this.job_id);
        break;
      case "cron_job":
        if (!this.job_id) {
          this.job_id = Math.round(Math.random(1000) * 1000);
        }
        image = await this.printer.getImage();
        text = this.printer.getMessageText();
        await this.sendData(text, image, this.job_id);
        break;
    }
  }

  start() {
    console.log("Starting Bot");
    this.bot.command("start", async (ctx) => {
      let chat_id = ctx.message.chat.id;
      console.log("Start " + chat_id);
    });
    this.bot.command("status", async (ctx) => {
      await this.getStatus();
    });
    this.bot.on("message", (ctx) => {
      console.log(ctx.update.message.from);
    });
    this.bot.telegram.setMyCommands(this.commands);

    this.bot.launch();
  }

  async stop(reason) {
    this.job.cancel(false);
    await this.bot.stop(reason);
    await this.printer.stop(reason);
  }

  isAdmin(user_id) {
    return this.config.admin.includes(user_id);
  }

  async sendData(text, photo, job_id) {
    try {
      if (this.sending_data) {
        console.log("Prev request running");
        return;
      }
      this.sending_data = true;
      this.last_update = new Date().getTime() / 1000;
      for (const chat_id of this.chats) {
        if (job_id) {
          let message = this.messages[job_id];
          if (!message) {
            if (photo) {
              let msg = await this.bot.telegram.sendPhoto(
                chat_id,
                Input.fromBuffer(photo),
                { caption: `${text}` }
              );
              this.messages[job_id] = msg;
              console.log(msg);
            } else {
              let msg = await this.bot.telegram.sendMessage(chat_id, `${text}`);
              this.messages[job_id] = msg;
            }
          } else {
            if (message.photo && !photo) {
              await this.bot.telegram.editMessageMedia(
                chat_id,
                this.messages[job_id].message_id,
                null,
                {
                  caption: `${text}`,
                  type: "photo",
                  media: message.photo[1].file_id,
                }
              );
            } else if (message.photo && photo) {
              await this.bot.telegram.editMessageMedia(
                chat_id,
                this.messages[job_id].message_id,
                null,
                {
                  caption: `${text}`,
                  type: "photo",
                  media: Input.fromBuffer(photo),
                }
              );
            } else {
              await this.bot.telegram.editMessageText(
                chat_id,
                this.messages[job_id].message_id,
                null,
                `${text}`
              );
            }
          }
        } else {
          if (photo) {
            let msg = await this.bot.telegram.sendPhoto(
              chat_id,
              Input.fromBuffer(photo, "image.png"),
              { caption: `${text}` }
            );
          } else {
            let msg = await this.bot.telegram.sendMessage(chat_id, `${text}`);
          }
        }
      }
      this.sending_data = false;
    } catch (e) {
      console.log(e);
      this.sending_data = false;
    }
  }
}
