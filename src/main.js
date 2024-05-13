import { Bot } from "./bot.js"
import config from '../config.js'

async function main(){
    const bots = config.bots.map(botConf=>{
        return new Bot(botConf)
    })
    
    const stopBots = () => {
        console.log("stopping")
        bots.map(bot=> bot.stop())
    }
    
    process.once('SIGINT', () => stopBots('SIGINT'))
    process.once('SIGTERM', () => stopBots('SIGTERM'))
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
  });