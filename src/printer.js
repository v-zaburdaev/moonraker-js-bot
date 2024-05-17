import Client from "jsonrpc-websocket-client";
import { createBackoff } from "jsonrpc-websocket-client";

export class Printer {
  config = null;
  wsclient = null;
  opened = false;
  status = {};
  prev_status = {};
  diff = {};
  n = 0;
  callback = null;
  proc_status = {};
  printer_info = {};
  logFile;
  constructor(config, callback) {
    this.config = config;
    this.callback = callback;
    this.open();
  }

  async open() {
    console.log("Starting printer");

    let uri = new URL(this.config.url.replace(/\/$/, "") + "/websocket");
    let wsUrl = `ws://${uri.hostname}:${uri.port}${uri.pathname}?token=${this.config.token}`;

    try {
      this.wsclient = new Client.JsonRpcWebSocketClient(wsUrl);
      await this.wsclient.open(createBackoff());
      this.opened = true;
    } catch (e) {
      this.callback("error", e);
      this.open();
    }

    let objects_query = await this.getObjectsQuery({
      print_stats: null,
      idle_timeout: null,
      display_status: null,
      extruder: null,
      virtual_sdcard: ["progress"],
    });
    this.status = this.mergeDeep(this.status, objects_query.status);

    let subscribe_objects = {
      print_stats: null,
      display_status: null,
      extruder: null,
      toolhead: null,
      "temperature_host raspberry": null,
      "temperature_sensor raspberry": null,
      "temperature_sensor MCU": null,
      system_stats: null,
      idle_timeout: null,
      heater_bed: null,
      heater_fan: null,
      virtual_sdcard: ["progress"],
      query_endstops: null,
      exclude_object: null,
    };
    let response = await this.subsribeObjects(subscribe_objects);

    this.wsclient.on("notification", this.recvNotification.bind(this));

    this.wsclient.on("open", () => {
      console.log("client is now open");
      this.opened = true;
    });

    this.wsclient.on("closed", () => {
      console.log("conn closed");
      this.opened = false;
      this.open();
    });

    await this.updatePrinterInfo();
  }

  recvNotification(notification) {
    if (notification.method === "notify_proc_stat_update") {
      this.proc_status = this.mergeDeep(
        this.proc_status,
        notification.params[0]
      );
    } else if (notification.method == "notify_status_update") {
      const prev_status = this.status.print_stats.state;
      const prev_m117 = this.status.display_status.message;

      this.status = this.mergeDeep(this.status, notification.params[0]);
      if (this.n == 0) {
        // console.log(this.printer_info);e
        this.n = 300;
        //   this.callback('state_change', this.status)
      }
      this.n--;
      if (
        prev_status === "standby" &&
        this.status.print_stats.state === "printing"
      ) {
        this.callback("start_print", this.status);
      } else if (
        prev_status === "printing" &&
        this.status.print_stats.state === "pause"
      ) {
        this.callback("pause_print", this.status);
      } else if (
        prev_status !== this.status.print_stats.state &&
        this.status.print_stats.state === "standby"
      ) {
        this.callback("cancel_print", this.status);
      } else if (
        this.status.print_stats.state === "printing" &&
        prev_status !== this.status.print_stats.state
      ) {
        this.callback("state_change", this.status);
      } else if (
        this.status.print_stats.state === "printing" &&
        prev_m117 !== this.status.display_status.message
      ) {
        this.callback("state_change", this.status);
      }
    } else if (notification.method === "notify_klippy_disconnected") {
      this.updatePrinterInfo();
      this.callback("error", this.status);
    } else if (notification.method === "notify_klippy_shutdown") {
      this.updatePrinterInfo();
      this.callback("error", this.status);
    } else if (notification.method === "notify_klippy_ready") {
      this.updatePrinterInfo();
      this.callback("state_change", this.status);
    } else {
      console.log({ notification });
    }
  }

  async stop(reason) {
    try {
      await this.wsclient.close();
    } catch (e) {
      console.log("close ", e);
    }
  }
  getStatus() {
    return this.status;
  }

  async getThumbnailImage(filename) {
    return new Promise(async (resolve, reject) => {
      if (this.opened) {
        let images_list = await this.wsclient.call("server.files.thumbnails", {
          filename,
        });
        if (images_list) {
          images_list = images_list
            .sort((a, b) => {
              return a.size < b.size ? 1 : -1;
            })
            .map((image) => ({
              ...image,
              url:
                this.config.url.replace(/\/$/, "") +
                "/server/files/gcodes/" +
                image.thumbnail_path,
            }));

          let res = await fetch(images_list[0].url);

          resolve(Buffer.from(await res.arrayBuffer()));
        }
      }
    });
  }
  // async getFilename(filename){
  //   if (this.opened) {
  //     return await this.wsclient.call("server.files.thumbnails", { filename });
  //   }
  // }

  getImage() {
    return new Promise(async (resolve, reject) => {
      if (this.opened) {
        if (this.printer_info.state === "ready") {
          if (this.status.print_stats.state === "printing") {
            let res = await fetch(this.config.cam_url);

            resolve(Buffer.from(await res.arrayBuffer()));
          }
        }
      }
    });
  }

  getMessageText() {
    let text = "";
    if (this.printer_info.state === "ready") {
      if (this.status.print_stats.state === "printing") {
        text +=
          `Printing: ${this.status.print_stats?.filename}\n` +
          `Duration: ${this.getPrintTime()} Est: ${this.getEstTime()}\n` +
          `M117 ${this.status.display_status.message}\n` +
          `Progress ${Math.round(
            this.status.display_status?.progress * 100,
            2
          )}%, height: ${this.getZPosition()}mm\n` +
          `Filament: ${Math.round(this.getFilamentUsed() / 10)}cm,\n` +
          `${this.addBedTemp()}\n` +
          `${this.addExtruderTemp()}\n` +
          `${this.addCPUTemp()}\n` +
          `${this.addMCUTemp()}\n`;
      } else {
        text += `Printer status: ${this.status.print_stats.state}\n`;
      }
    } else if (this.printer_info.state === "shutdown") {
      text += `Printer status: ${this.printer_info.state}\n`;
      text += `${this.printer_info.state_message}\n`;
    }

    text +=
      "Last update at " +
      new Date().toLocaleDateString() +
      " " +
      new Date().toLocaleTimeString();
    return text;
  }

  addPrintTime() {
    return `Printing for ${this.status.toolhead?.print_time} / ${this.status.toolhead?.estimated_print_time} / ${this.status.idle_timeout?.printing_time}`;
  }
  addBedTemp() {
    return `♨️ Heater Bed: ${this.status.heater_bed?.temperature} °C ${
      this.status.heater_bed?.power > 0 ? "🔥" : ""
    }`;
  }

  addExtruderTemp() {
    return `♨️ Extruder: ${this.status.extruder?.temperature} °C ${
      this.status.extruder?.power > 0 ? "🔥" : ""
    }`;
  }
  addMCUTemp() {
    return `🌡️ Mcu Temp: ${this.status["temperature_sensor MCU"]?.temperature} °C`;
  }
  addCPUTemp() {
    return `🌡️ CPU Temp: ${this.status["temperature_sensor raspberry"]?.temperature} °C`;
  }
  getZPosition() {
    if (
      this.status.toolhead &&
      this.status.toolhead?.position &&
      this.status.toolhead?.position.length == 4
    ) {
      return `${this.status.toolhead?.position[2]}`;
    }
    return "";
  }
  getExtruded() {
    if (
      this.status.toolhead &&
      this.status.toolhead?.position &&
      this.status.toolhead?.position.length == 4
    ) {
      return `Extruded ${this.status.toolhead?.position[3] / 1000}`;
    }
    return "";
  }
  getFilamentUsed() {
    return this.status.print_stats?.filament_used;
  }
  getCurrentObject() {
    return `Current object : ${this.status.exclude_object.current_object}`;
  }

  getPrintTime() {
    let print_time = new Date(this.status.print_stats?.print_duration * 1000);
    if (print_time.getHours() > 24) {
      return ` ${print_time.getDay()}, ${print_time.getHours()}:${print_time.getMinutes()}:${print_time.getSeconds()}`;
    } else {
      return `${print_time.getHours()}:${print_time.getMinutes()}:${print_time.getSeconds()}`;
    }
  }
  getEstTime() {
    let print_time = new Date(this.status.print_stats?.total_duration * 1000);
    if (print_time.getHours() > 24) {
      return ` ${print_time.getDay()}, ${print_time.getHours()}:${print_time.getMinutes()}:${print_time.getSeconds()}`;
    } else {
      return `${print_time.getHours()}:${print_time.getMinutes()}:${print_time.getSeconds()}`;
    }
  }

  getPrinterInfo() {
    return this.printer_info;
  }

  async updatePrinterInfo() {
    this.printer_info = await this.getPrinterInfo();
  }

  async subsribeObjects(objects) {
    if (this.opened) {
      return await this.wsclient.call("printer.objects.subscribe", {
        objects: objects,
      });
    }
  }

  async getObjectsQuery(objects) {
    if (this.opened) {
      return await this.wsclient.call("printer.objects.query", {
        objects: objects,
      });
    }
  }

  async getObjectsList() {
    if (this.opened) {
      return await this.wsclient.call("printer.objects.list");
    }
  }

  async getSystemStatus() {
    if (this.opened) {
      return await this.wsclient.call("server.info");
    }
  }

  async getPrinterInfo() {
    if (this.opened) {
      return await this.wsclient.call("printer.info");
    }
  }
  /**
   * Simple object check.
   * @param item
   * @returns {boolean}
   */
  isObject(item) {
    return item && typeof item === "object" && !Array.isArray(item);
  }

  /**
   * Deep merge two objects.
   * @param target
   * @param ...sources
   */
  mergeDeep(target, ...sources) {
    if (!sources.length) return target;
    const source = sources.shift();

    if (this.isObject(target) && this.isObject(source)) {
      for (const key in source) {
        if (this.isObject(source[key])) {
          if (!target[key]) Object.assign(target, { [key]: {} });
          this.mergeDeep(target[key], source[key]);
        } else {
          Object.assign(target, { [key]: source[key] });
        }
      }
    }

    return this.mergeDeep(target, ...sources);
  }
}
