export default  {
  bots: [
    {
      bot_token: "___BOT__TOKEN___",
      admins: [INT_ADMIN_ID],
      chats: [CHATS_IDS],
      printer: {
        name: "Printer 1",
        url: "http://192.168.100.100:7125/",
        cam_url: "http://192.168.100.100/webcam/?action=snapshot",
        token: '___PRINTER_TOKEN____'   
      },
      scheduleJobs:[{
        cronString: '* */1 * * * *',

      }]
    },
  ]};
