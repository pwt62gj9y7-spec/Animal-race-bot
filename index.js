console.log("Animal Racing Bot is starting...");

const animals = ["🐺 Wolf", "🦊 Fox", "🐰 Rabbit", "🐯 Tiger"];

function race() {
  let winner = animals[Math.floor(Math.random() * animals.length)];
  console.log(`🏁 Winner: ${winner}`);
}

setInterval(race, 10000);
