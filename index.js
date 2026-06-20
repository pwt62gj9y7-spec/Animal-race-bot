const { Client, GatewayIntentBits, EmbedBuilder, Partials } = require("discord.js");
const config = require("./config");
const { recordResult, recordAnimal, getLeaderboard, getUserStats } = require("./leaderboard");
const { addWarning, getWarnings, clearWarnings, removeWarning } = require("./warnings");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ],
  partials: [Partials.Message, Partials.Reaction, Partials.User]
});

const ANIMAL_POOL = [
  { name: "Wolf",      emoji: "🐺" },
  { name: "Fox",       emoji: "🦊" },
  { name: "Rabbit",    emoji: "🐰" },
  { name: "Tiger",     emoji: "🐯" },
  { name: "Bear",      emoji: "🐻" },
  { name: "Lion",      emoji: "🦁" },
  { name: "Cheetah",   emoji: "🐆" },
  { name: "Eagle",     emoji: "🦅" },
  { name: "Panda",     emoji: "🐼" },
  { name: "Horse",     emoji: "🐎" }
];

const MAX_PLAYERS = 5;
const COUNTDOWN = 30;

const activeRaces = new Map();
const lastRaces = new Map();
const afkUsers = new Map();

function assignAnimals(playerIds) {
  const shuffledAnimals = [...ANIMAL_POOL].sort(() => Math.random() - 0.5);
  const assignments = new Map();
  playerIds.forEach((userId, i) => {
    assignments.set(userId, shuffledAnimals[i]);
  });
  return assignments;
}

async function resolveRace(interaction, channelId) {
  const race = activeRaces.get(channelId);
  if (!race) return;
  activeRaces.delete(channelId);

  if (race.players.size === 0) {
    await interaction.followUp("🏁 The race was cancelled — nobody joined!");
    return;
  }

  const playerList = [...race.players.values()];
  const shuffled = [...playerList].sort(() => Math.random() - 0.5);
  const winner = shuffled[0];

  const medals = ["🥇", "🥈", "🥉", "4️⃣", "5️⃣"];
  const results = shuffled
    .map((p, i) => `${medals[i]} ${p.emoji} **${p.username}** (${p.animalName})`)
    .join("\n");

  lastRaces.set(channelId, [...race.players.entries()].map(([userId, p]) => ({ userId, username: p.username })));

  for (const [userId, p] of race.players) {
    const won = userId === winner.userId;
    recordResult(userId, p.username, won);
    recordAnimal(userId, p.username, p.animalName);
  }

  const bets = race.bets;
  let betSummary = "";
  if (bets.size > 0) {
    const betWinners = [];
    const betLosers = [];
    for (const [userId, { animalName, username }] of bets) {
      if (animalName === winner.animalName) {
        betWinners.push(`<@${userId}>`);
      } else {
        betLosers.push(`<@${userId}> (bet on ${animalName})`);
      }
    }
    betSummary += "\n\n**🎰 Spectator Bets:**\n";
    if (betWinners.length > 0) betSummary += `✅ **Won:** ${betWinners.join(", ")}\n`;
    if (betLosers.length > 0) betSummary += `❌ **Lost:** ${betLosers.join(", ")}`;
  }

  await interaction.followUp(
    `🏁 **Race Over!**\n\n${results}\n\n` +
    `🎉 **${winner.emoji} ${winner.username} wins as the ${winner.animalName}!**` +
    betSummary +
    `\n\n_Use \`/rematch\` to race again with the same players!_`
  );
}

async function startRace(interaction, channelId, preloadedPlayers = []) {
  activeRaces.set(channelId, {
    players: new Map(),
    bets: new Map(),
    started: Date.now()
  });

  const race = activeRaces.get(channelId);

  if (preloadedPlayers.length > 0) {
    const assignments = assignAnimals(preloadedPlayers.map(p => p.userId));
    for (const p of preloadedPlayers) {
      const animal = assignments.get(p.userId);
      race.players.set(p.userId, {
        userId: p.userId,
        username: p.username,
        animalName: animal.name,
        emoji: animal.emoji
      });
    }

    const playerLines = [...race.players.values()]
      .map(p => `${p.emoji} **${p.username}** (${p.animalName})`)
      .join("\n");

    await interaction.reply(
      `🔄 **Rematch starting!** Same players, new animals:\n\n${playerLines}\n\n` +
      `🎲 Spectators can use \`/bet\` to wager on an animal.\n` +
      `⏳ Race begins in **${COUNTDOWN} seconds!**`
    );
  } else {
    await interaction.reply(
      `🏟️ **A new Animal Race is starting!**\n\n` +
      `Use \`/join\` to enter — you'll be assigned a random animal!\n` +
      `🎲 Spectators can use \`/bet\` to wager on an animal.\n\n` +
      `⏳ Race begins in **${COUNTDOWN} seconds** — up to **${MAX_PLAYERS} racers** can join!`
    );
  }

  setTimeout(() => resolveRace(interaction, channelId), COUNTDOWN * 1000);
}

client.once("clientReady", () => {
  console.log(`✅ ${client.user.tag} is online and ready!`);
});

client.on("interactionCreate", async interaction => {
  if (!interaction.isChatInputCommand()) return;

  const channelId = interaction.channelId;

  if (interaction.commandName === "race") {
    if (activeRaces.has(channelId)) {
      await interaction.reply({ content: "⚠️ A race is already in progress! Use `/join` to enter.", ephemeral: true });
      return;
    }
    await startRace(interaction, channelId);
  }

  if (interaction.commandName === "rematch") {
    if (activeRaces.has(channelId)) {
      await interaction.reply({ content: "⚠️ A race is already in progress! Use `/join` to enter.", ephemeral: true });
      return;
    }

    const last = lastRaces.get(channelId);
    if (!last || last.length === 0) {
      await interaction.reply({ content: "⚠️ No previous race found in this channel. Start one with `/race`!", ephemeral: true });
      return;
    }

    await startRace(interaction, channelId, last);
  }

  if (interaction.commandName === "join") {
    if (!activeRaces.has(channelId)) {
      await interaction.reply({ content: "⚠️ No race is active right now. Start one with `/race`!", ephemeral: true });
      return;
    }

    const race = activeRaces.get(channelId);
    const userId = interaction.user.id;
    const username = interaction.user.username;

    if (race.players.has(userId)) {
      const existing = race.players.get(userId);
      await interaction.reply({ content: `⚠️ You're already in the race as **${existing.emoji} ${existing.animalName}**!`, ephemeral: true });
      return;
    }

    if (race.players.size >= MAX_PLAYERS) {
      await interaction.reply({ content: `⚠️ The race is full! (${MAX_PLAYERS}/${MAX_PLAYERS} racers)`, ephemeral: true });
      return;
    }

    const usedAnimals = new Set([...race.players.values()].map(p => p.animalName));
    const available = ANIMAL_POOL.filter(a => !usedAnimals.has(a.name));
    const assigned = available[Math.floor(Math.random() * available.length)];

    race.players.set(userId, { userId, username, animalName: assigned.name, emoji: assigned.emoji });

    const count = race.players.size;
    const spotsLeft = MAX_PLAYERS - count;

    await interaction.reply(
      `${assigned.emoji} **${username}** joined the race as the **${assigned.animalName}**!\n` +
      `👥 ${count}/${MAX_PLAYERS} racers${spotsLeft > 0 ? ` — ${spotsLeft} spot(s) left!` : " — Race is full!"}`
    );
  }

  if (interaction.commandName === "bet") {
    if (!activeRaces.has(channelId)) {
      await interaction.reply({ content: "⚠️ No race is active right now. Start one with `/race`!", ephemeral: true });
      return;
    }

    const race = activeRaces.get(channelId);
    const userId = interaction.user.id;
    const username = interaction.user.username;

    if (race.players.has(userId)) {
      await interaction.reply({ content: "⚠️ You're already racing — only spectators can bet!", ephemeral: true });
      return;
    }

    const chosen = interaction.options.getString("animal");
    race.bets.set(userId, { animalName: chosen, username });

    const animal = ANIMAL_POOL.find(a => a.name === chosen);
    await interaction.reply(`🎲 **${username}** bet on **${animal.emoji} ${chosen}**! Good luck!`);
  }

  if (interaction.commandName === "stats") {
    const userId = interaction.user.id;
    const stats = getUserStats(userId);

    if (!stats) {
      await interaction.reply({ content: "📊 You haven't raced yet! Use `/race` then `/join` to get started.", ephemeral: true });
      return;
    }

    const total = stats.wins + stats.losses;
    const winRate = total > 0 ? Math.round((stats.wins / total) * 100) : 0;

    let favouriteAnimal = "None";
    if (stats.animalCounts) {
      const top = Object.entries(stats.animalCounts).sort((a, b) => b[1] - a[1])[0];
      if (top) {
        const animal = ANIMAL_POOL.find(a => a.name === top[0]);
        favouriteAnimal = `${animal ? animal.emoji : ""} ${top[0]} (raced ${top[1]}x)`;
      }
    }

    const board = getLeaderboard();
    const rank = board.findIndex(e => e.userId === userId) + 1;
    const rankText = rank > 0 ? `#${rank} of ${board.length}` : "Unranked";

    await interaction.reply(
      `📊 **${stats.username}'s Racing Stats**\n\n` +
      `🏆 **Wins:** ${stats.wins}\n` +
      `❌ **Losses:** ${stats.losses}\n` +
      `📈 **Win Rate:** ${winRate}%\n` +
      `🎯 **Total Races:** ${total}\n` +
      `❤️ **Favourite Animal:** ${favouriteAnimal}\n` +
      `🏅 **Leaderboard Rank:** ${rankText}`
    );
  }

  if (interaction.commandName === "leaderboard") {
    const board = getLeaderboard();

    if (board.length === 0) {
      await interaction.reply("📊 No races completed yet! Use `/race` and `/join` to get started.");
      return;
    }

    const medals = ["🥇", "🥈", "🥉"];
    const rows = board.slice(0, 10).map((entry, i) => {
      const rank = medals[i] || `**${i + 1}.**`;
      const total = entry.wins + entry.losses;
      const winRate = total > 0 ? Math.round((entry.wins / total) * 100) : 0;
      return `${rank} **${entry.username}** — ${entry.wins}W / ${entry.losses}L (${winRate}% win rate)`;
    });

    await interaction.reply(`🏆 **Animal Racing Leaderboard**\n\n${rows.join("\n")}`);
  }

  // ── Moderation ──────────────────────────────────────────────

  function parseDuration(str) {
    const match = str.match(/^(\d+)(s|m|h|d|w)$/i);
    if (!match) return null;
    const val = parseInt(match[1]);
    const unit = match[2].toLowerCase();
    const ms = { s: 1000, m: 60000, h: 3600000, d: 86400000, w: 604800000 }[unit];
    return val * ms;
  }

  function modEmbed(color, title, user, fields = []) {
    return new EmbedBuilder()
      .setColor(color)
      .setAuthor({ name: user.username, iconURL: user.displayAvatarURL() })
      .setThumbnail(user.displayAvatarURL({ size: 128 }))
      .setTitle(title)
      .addFields(fields)
      .setTimestamp();
  }

  if (interaction.commandName === "addrole") {
    const target = interaction.options.getMember("user");
    const role = interaction.options.getRole("role");
    if (!target) return interaction.reply({ content: "❌ User not found.", ephemeral: true });
    if (!interaction.member.permissions.has("ManageRoles"))
      return interaction.reply({ content: "❌ You don't have permission to manage roles.", ephemeral: true });
    if (role.position >= interaction.guild.members.me.roles.highest.position)
      return interaction.reply({ content: "❌ I can't assign that role — it's higher than or equal to my own role.", ephemeral: true });
    try {
      await target.roles.add(role);
      await interaction.reply({ embeds: [modEmbed(0x57F287, "✅ Role Added", target.user, [
        { name: "User", value: `<@${target.id}>`, inline: true },
        { name: "Role", value: `<@&${role.id}>`, inline: true },
        { name: "Moderator", value: interaction.user.username, inline: true }
      ])] });
    } catch {
      await interaction.reply({ content: "❌ Failed to add role — make sure I have the **Manage Roles** permission.", ephemeral: true });
    }
  }

  if (interaction.commandName === "removerole") {
    const target = interaction.options.getMember("user");
    const role = interaction.options.getRole("role");
    if (!target) return interaction.reply({ content: "❌ User not found.", ephemeral: true });
    if (!interaction.member.permissions.has("ManageRoles"))
      return interaction.reply({ content: "❌ You don't have permission to manage roles.", ephemeral: true });
    if (role.position >= interaction.guild.members.me.roles.highest.position)
      return interaction.reply({ content: "❌ I can't remove that role — it's higher than or equal to my own role.", ephemeral: true });
    if (!target.roles.cache.has(role.id))
      return interaction.reply({ content: `❌ **${target.user.username}** doesn't have that role.`, ephemeral: true });
    try {
      await target.roles.remove(role);
      await interaction.reply({ embeds: [modEmbed(0xED4245, "🗑️ Role Removed", target.user, [
        { name: "User", value: `<@${target.id}>`, inline: true },
        { name: "Role", value: `<@&${role.id}>`, inline: true },
        { name: "Moderator", value: interaction.user.username, inline: true }
      ])] });
    } catch {
      await interaction.reply({ content: "❌ Failed to remove role — make sure I have the **Manage Roles** permission.", ephemeral: true });
    }
  }

  if (interaction.commandName === "promote") {
    const target = interaction.options.getMember("user");
    if (!target) return interaction.reply({ content: "❌ User not found.", ephemeral: true });
    if (!interaction.member.permissions.has("ManageRoles"))
      return interaction.reply({ content: "❌ You don't have permission to manage roles.", ephemeral: true });

    const myHighest = interaction.guild.members.me.roles.highest.position;
    const assignableRoles = interaction.guild.roles.cache
      .filter(r => !r.managed && r.name !== "@everyone" && r.position < myHighest)
      .sort((a, b) => a.position - b.position);

    const currentHighest = target.roles.cache
      .filter(r => r.name !== "@everyone")
      .sort((a, b) => b.position - a.position)
      .first();

    const currentPos = currentHighest ? currentHighest.position : 0;
    const nextRole = assignableRoles.find(r => r.position > currentPos);

    if (!nextRole)
      return interaction.reply({ content: "❌ This member is already at the highest role I can assign.", ephemeral: true });

    try {
      if (currentHighest) await target.roles.remove(currentHighest);
      await target.roles.add(nextRole);
      await interaction.reply({ embeds: [modEmbed(0x57F287, "⬆️ Member Promoted", target.user, [
        { name: "User", value: `<@${target.id}>`, inline: true },
        { name: "From", value: currentHighest ? `<@&${currentHighest.id}>` : "No role", inline: true },
        { name: "To", value: `<@&${nextRole.id}>`, inline: true },
        { name: "Moderator", value: interaction.user.username, inline: true }
      ])] });
    } catch {
      await interaction.reply({ content: "❌ Failed to promote — make sure I have the **Manage Roles** permission and my role is above theirs.", ephemeral: true });
    }
  }

  if (interaction.commandName === "demote") {
    const target = interaction.options.getMember("user");
    if (!target) return interaction.reply({ content: "❌ User not found.", ephemeral: true });
    if (!interaction.member.permissions.has("ManageRoles"))
      return interaction.reply({ content: "❌ You don't have permission to manage roles.", ephemeral: true });

    const myHighest = interaction.guild.members.me.roles.highest.position;
    const assignableRoles = interaction.guild.roles.cache
      .filter(r => !r.managed && r.name !== "@everyone" && r.position < myHighest)
      .sort((a, b) => b.position - a.position);

    const currentHighest = target.roles.cache
      .filter(r => r.name !== "@everyone")
      .sort((a, b) => b.position - a.position)
      .first();

    if (!currentHighest)
      return interaction.reply({ content: "❌ This member has no roles to demote from.", ephemeral: true });

    const prevRole = assignableRoles.find(r => r.position < currentHighest.position);

    try {
      await target.roles.remove(currentHighest);
      if (prevRole) await target.roles.add(prevRole);
      await interaction.reply({ embeds: [modEmbed(0xFEE75C, "⬇️ Member Demoted", target.user, [
        { name: "User", value: `<@${target.id}>`, inline: true },
        { name: "From", value: `<@&${currentHighest.id}>`, inline: true },
        { name: "To", value: prevRole ? `<@&${prevRole.id}>` : "No role", inline: true },
        { name: "Moderator", value: interaction.user.username, inline: true }
      ])] });
    } catch {
      await interaction.reply({ content: "❌ Failed to demote — make sure I have the **Manage Roles** permission and my role is above theirs.", ephemeral: true });
    }
  }

  if (interaction.commandName === "kick") {
    const target = interaction.options.getMember("user");
    const reason = interaction.options.getString("reason") || "No reason provided";
    if (!target) return interaction.reply({ content: "❌ User not found.", ephemeral: true });
    if (!interaction.member.permissions.has("KickMembers"))
      return interaction.reply({ content: "❌ You don't have permission to kick members.", ephemeral: true });
    try {
      await target.kick(reason);
      await interaction.reply({ embeds: [modEmbed(0xEB459E, "👢 Member Kicked", target.user, [
        { name: "User", value: `${target.user.username}`, inline: true },
        { name: "Reason", value: reason, inline: true },
        { name: "Moderator", value: interaction.user.username, inline: true }
      ])] });
    } catch {
      await interaction.reply({ content: "❌ Failed to kick — make sure I have the **Kick Members** permission and my role is above theirs.", ephemeral: true });
    }
  }

  if (interaction.commandName === "ban") {
    const target = interaction.options.getMember("user");
    const reason = interaction.options.getString("reason") || "No reason provided";
    if (!target) return interaction.reply({ content: "❌ User not found.", ephemeral: true });
    if (!interaction.member.permissions.has("BanMembers"))
      return interaction.reply({ content: "❌ You don't have permission to ban members.", ephemeral: true });
    try {
      await target.ban({ reason });
      await interaction.reply({ embeds: [modEmbed(0xED4245, "🔨 Member Banned", target.user, [
        { name: "User", value: `<@${target.id}>`, inline: true },
        { name: "Reason", value: reason, inline: true },
        { name: "Moderator", value: interaction.user.username, inline: true }
      ])] });
    } catch {
      await interaction.reply({ content: "❌ Failed to ban — make sure I have the **Ban Members** permission and my role is above theirs.", ephemeral: true });
    }
  }

  if (interaction.commandName === "unban") {
    const userId = interaction.options.getString("user_id");
    const reason = interaction.options.getString("reason") || "No reason provided";
    if (!interaction.member.permissions.has("BanMembers"))
      return interaction.reply({ content: "❌ You don't have permission to unban members.", ephemeral: true });
    try {
      const unbanned = await interaction.guild.members.unban(userId, reason);
      await interaction.reply({ embeds: [new EmbedBuilder()
        .setColor(0x57F287)
        .setTitle("✅ Member Unbanned")
        .addFields(
          { name: "User", value: `${unbanned.username} (${userId})`, inline: true },
          { name: "Reason", value: reason, inline: true },
          { name: "Moderator", value: interaction.user.username, inline: true }
        )
        .setTimestamp()
      ] });
    } catch {
      await interaction.reply({ content: "❌ Failed to unban — make sure that user ID is valid and the user is actually banned.", ephemeral: true });
    }
  }

  if (interaction.commandName === "mute") {
    const target = interaction.options.getMember("user");
    const durationStr = interaction.options.getString("duration") || "1h";
    const reason = interaction.options.getString("reason") || "No reason provided";
    if (!target) return interaction.reply({ content: "❌ User not found.", ephemeral: true });
    if (!interaction.member.permissions.has("ModerateMembers"))
      return interaction.reply({ content: "❌ You don't have permission to mute members.", ephemeral: true });
    const ms = parseDuration(durationStr);
    if (!ms) return interaction.reply({ content: "❌ Invalid duration. Use formats like `10m`, `1h`, `7d`.", ephemeral: true });
    if (ms > 28 * 24 * 3600 * 1000) return interaction.reply({ content: "❌ Maximum mute duration is 28 days.", ephemeral: true });
    try {
      await target.timeout(ms, reason);
      await interaction.reply({ embeds: [modEmbed(0xFEE75C, "🔇 Member Muted", target.user, [
        { name: "User", value: `<@${target.id}>`, inline: true },
        { name: "Duration", value: durationStr, inline: true },
        { name: "Reason", value: reason, inline: true },
        { name: "Moderator", value: interaction.user.username, inline: true }
      ])] });
    } catch {
      await interaction.reply({ content: "❌ Failed to mute — make sure I have the **Timeout Members** permission and my role is above theirs.", ephemeral: true });
    }
  }

  if (interaction.commandName === "unmute") {
    const target = interaction.options.getMember("user");
    if (!target) return interaction.reply({ content: "❌ User not found.", ephemeral: true });
    if (!interaction.member.permissions.has("ModerateMembers"))
      return interaction.reply({ content: "❌ You don't have permission to unmute members.", ephemeral: true });
    try {
      await target.timeout(null);
      await interaction.reply({ embeds: [modEmbed(0x57F287, "🔊 Member Unmuted", target.user, [
        { name: "User", value: `<@${target.id}>`, inline: true },
        { name: "Moderator", value: interaction.user.username, inline: true }
      ])] });
    } catch {
      await interaction.reply({ content: "❌ Failed to unmute — make sure I have the **Timeout Members** permission.", ephemeral: true });
    }
  }

  if (interaction.commandName === "timeout") {
    const target = interaction.options.getMember("user");
    const durationStr = interaction.options.getString("duration");
    const reason = interaction.options.getString("reason") || "No reason provided";
    if (!target) return interaction.reply({ content: "❌ User not found.", ephemeral: true });
    if (!interaction.member.permissions.has("ModerateMembers"))
      return interaction.reply({ content: "❌ You don't have permission to timeout members.", ephemeral: true });
    const ms = parseDuration(durationStr);
    if (!ms) return interaction.reply({ content: "❌ Invalid duration. Use formats like `10m`, `1h`, `7d`.", ephemeral: true });
    if (ms > 28 * 24 * 3600 * 1000) return interaction.reply({ content: "❌ Maximum timeout duration is 28 days.", ephemeral: true });
    try {
      await target.timeout(ms, reason);
      await interaction.reply({ embeds: [modEmbed(0xEB459E, "⏱️ Member Timed Out", target.user, [
        { name: "User", value: `<@${target.id}>`, inline: true },
        { name: "Duration", value: durationStr, inline: true },
        { name: "Reason", value: reason, inline: true },
        { name: "Moderator", value: interaction.user.username, inline: true }
      ])] });
    } catch {
      await interaction.reply({ content: "❌ Failed to timeout — make sure I have the **Timeout Members** permission and my role is above theirs.", ephemeral: true });
    }
  }

  if (interaction.commandName === "removetimeout") {
    const target = interaction.options.getMember("user");
    if (!target) return interaction.reply({ content: "❌ User not found.", ephemeral: true });
    if (!interaction.member.permissions.has("ModerateMembers"))
      return interaction.reply({ content: "❌ You don't have permission to remove timeouts.", ephemeral: true });
    try {
      await target.timeout(null);
      await interaction.reply({ embeds: [modEmbed(0x57F287, "✅ Timeout Removed", target.user, [
        { name: "User", value: `<@${target.id}>`, inline: true },
        { name: "Moderator", value: interaction.user.username, inline: true }
      ])] });
    } catch {
      await interaction.reply({ content: "❌ Failed to remove timeout — make sure I have the **Timeout Members** permission.", ephemeral: true });
    }
  }

  if (interaction.commandName === "warn") {
    const target = interaction.options.getMember("user");
    const reason = interaction.options.getString("reason");
    if (!target) return interaction.reply({ content: "❌ User not found.", ephemeral: true });
    if (!interaction.member.permissions.has("ModerateMembers"))
      return interaction.reply({ content: "❌ You don't have permission to warn members.", ephemeral: true });

    const total = addWarning(target.id, target.user.username, reason, interaction.user.username);

    const embed = modEmbed(0xFFA500, `⚠️ Warning Issued — ${total} Total`, target.user, [
      { name: "User", value: `<@${target.id}>`, inline: true },
      { name: "Reason", value: reason, inline: true },
      { name: "Moderator", value: interaction.user.username, inline: true },
      { name: "Total Warnings", value: `${total}`, inline: true }
    ]);
    await interaction.reply({ embeds: [embed] });

    try {
      await target.user.send({
        embeds: [new EmbedBuilder()
          .setColor(0xFFA500)
          .setTitle(`⚠️ You received a warning in ${interaction.guild.name}`)
          .addFields(
            { name: "Reason", value: reason, inline: true },
            { name: "Moderator", value: interaction.user.username, inline: true },
            { name: "Total Warnings", value: `${total}`, inline: true }
          )
          .setTimestamp()
        ]
      });
    } catch {}
  }

  if (interaction.commandName === "warnings") {
    const target = interaction.options.getMember("user");
    if (!target) return interaction.reply({ content: "❌ User not found.", ephemeral: true });

    const record = getWarnings(target.id);

    if (!record || record.warnings.length === 0) {
      return interaction.reply({ embeds: [modEmbed(0x57F287, "✅ No Warnings", target.user, [
        { name: "Status", value: "This member has no warnings.", inline: false }
      ])] });
    }

    const warningList = record.warnings.map((w, i) => {
      const date = new Date(w.timestamp).toDateString();
      return `**${i + 1}.** ${w.reason}\n└ by **${w.moderator}** on ${date}`;
    }).join("\n\n");

    const embed = new EmbedBuilder()
      .setColor(0xFFA500)
      .setAuthor({ name: target.user.username, iconURL: target.user.displayAvatarURL() })
      .setThumbnail(target.user.displayAvatarURL({ size: 128 }))
      .setTitle(`⚠️ Warnings — ${record.warnings.length} Total`)
      .setDescription(warningList)
      .setFooter({ text: "Use /removewarning to remove one, or /clearwarnings to clear all" })
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
  }

  if (interaction.commandName === "clearwarnings") {
    const target = interaction.options.getMember("user");
    if (!target) return interaction.reply({ content: "❌ User not found.", ephemeral: true });
    if (!interaction.member.permissions.has("ModerateMembers"))
      return interaction.reply({ content: "❌ You don't have permission to clear warnings.", ephemeral: true });

    const cleared = clearWarnings(target.id);
    if (!cleared) return interaction.reply({ content: "⚠️ That member has no warnings to clear.", ephemeral: true });

    await interaction.reply({ embeds: [modEmbed(0x57F287, "🗑️ Warnings Cleared", target.user, [
      { name: "User", value: `<@${target.id}>`, inline: true },
      { name: "Moderator", value: interaction.user.username, inline: true }
    ])] });
  }

  // ── Utility & Fun ────────────────────────────────────────────

  if (interaction.commandName === "purge") {
    const amount = interaction.options.getInteger("amount");
    if (!interaction.member.permissions.has("ManageMessages"))
      return interaction.reply({ content: "❌ You don't have permission to manage messages.", ephemeral: true });
    try {
      const deleted = await interaction.channel.bulkDelete(amount, true);
      await interaction.reply({ content: `🗑️ Deleted **${deleted.size}** message(s).`, ephemeral: true });
    } catch {
      await interaction.reply({ content: "❌ Failed — messages older than 14 days can't be bulk deleted.", ephemeral: true });
    }
  }

  if (interaction.commandName === "lock") {
    if (!interaction.member.permissions.has("ManageChannels"))
      return interaction.reply({ content: "❌ You don't have permission to manage channels.", ephemeral: true });
    await interaction.channel.permissionOverwrites.edit(interaction.guild.roles.everyone, { SendMessages: false });
    await interaction.reply({ embeds: [new EmbedBuilder().setColor(0xED4245).setTitle("🔒 Channel Locked").setDescription(`${interaction.channel} has been locked by ${interaction.user}.`).setTimestamp()] });
  }

  if (interaction.commandName === "unlock") {
    if (!interaction.member.permissions.has("ManageChannels"))
      return interaction.reply({ content: "❌ You don't have permission to manage channels.", ephemeral: true });
    await interaction.channel.permissionOverwrites.edit(interaction.guild.roles.everyone, { SendMessages: null });
    await interaction.reply({ embeds: [new EmbedBuilder().setColor(0x57F287).setTitle("🔓 Channel Unlocked").setDescription(`${interaction.channel} has been unlocked by ${interaction.user}.`).setTimestamp()] });
  }

  if (interaction.commandName === "slowmode") {
    const seconds = interaction.options.getInteger("seconds");
    if (!interaction.member.permissions.has("ManageChannels"))
      return interaction.reply({ content: "❌ You don't have permission to manage channels.", ephemeral: true });
    await interaction.channel.setRateLimitPerUser(seconds);
    const label = seconds === 0 ? "disabled" : `set to **${seconds}s**`;
    await interaction.reply({ embeds: [new EmbedBuilder().setColor(0x5865F2).setTitle("🐢 Slowmode Updated").setDescription(`Slowmode in ${interaction.channel} is now ${label}.`).setTimestamp()] });
  }

  if (interaction.commandName === "serverinfo") {
    const guild = interaction.guild;
    await guild.fetch();
    const embed = new EmbedBuilder()
      .setColor(0x5865F2)
      .setTitle(guild.name)
      .setThumbnail(guild.iconURL({ size: 256 }))
      .addFields(
        { name: "👥 Members", value: `${guild.memberCount}`, inline: true },
        { name: "📅 Created", value: `<t:${Math.floor(guild.createdTimestamp / 1000)}:D>`, inline: true },
        { name: "🌟 Boost Level", value: `Level ${guild.premiumTier}`, inline: true },
        { name: "💎 Boosts", value: `${guild.premiumSubscriptionCount || 0}`, inline: true },
        { name: "📺 Channels", value: `${guild.channels.cache.size}`, inline: true },
        { name: "😀 Emojis", value: `${guild.emojis.cache.size}`, inline: true }
      )
      .setFooter({ text: `ID: ${guild.id}` })
      .setTimestamp();
    await interaction.reply({ embeds: [embed] });
  }

  if (interaction.commandName === "userinfo") {
    const target = interaction.options.getMember("user") || interaction.member;
    const user = target.user;
    const roles = target.roles.cache
      .filter(r => r.name !== "@everyone")
      .sort((a, b) => b.position - a.position)
      .map(r => `<@&${r.id}>`)
      .join(", ") || "None";
    const embed = new EmbedBuilder()
      .setColor(0x5865F2)
      .setAuthor({ name: user.username, iconURL: user.displayAvatarURL() })
      .setThumbnail(user.displayAvatarURL({ size: 256 }))
      .addFields(
        { name: "🆔 User ID", value: user.id, inline: true },
        { name: "🤖 Bot", value: user.bot ? "Yes" : "No", inline: true },
        { name: "📅 Account Created", value: `<t:${Math.floor(user.createdTimestamp / 1000)}:D>`, inline: true },
        { name: "📥 Joined Server", value: `<t:${Math.floor(target.joinedTimestamp / 1000)}:D>`, inline: true },
        { name: `🎭 Roles (${target.roles.cache.size - 1})`, value: roles.length > 1024 ? "Too many to display" : roles }
      )
      .setTimestamp();
    await interaction.reply({ embeds: [embed] });
  }

  if (interaction.commandName === "ping") {
    const sent = await interaction.reply({ content: "Pinging...", fetchReply: true });
    await interaction.editReply(`🏓 **Pong!**\n📶 Latency: **${sent.createdTimestamp - interaction.createdTimestamp}ms**\n💡 API: **${Math.round(client.ws.ping)}ms**`);
  }

  if (interaction.commandName === "poll") {
    const question = interaction.options.getString("question");
    const opts = [
      interaction.options.getString("option1"),
      interaction.options.getString("option2"),
      interaction.options.getString("option3"),
      interaction.options.getString("option4")
    ].filter(Boolean);

    const emojis = ["1️⃣", "2️⃣", "3️⃣", "4️⃣"];
    const isCustom = opts.length >= 2;
    const description = isCustom ? opts.map((o, i) => `${emojis[i]} ${o}`).join("\n") : "Vote using the reactions below!";
    const reactions = isCustom ? emojis.slice(0, opts.length) : ["✅", "❌"];

    const embed = new EmbedBuilder()
      .setColor(0x5865F2)
      .setTitle(`📊 ${question}`)
      .setDescription(description)
      .setFooter({ text: `Poll by ${interaction.user.username}` })
      .setTimestamp();

    const msg = await interaction.reply({ embeds: [embed], fetchReply: true });
    for (const r of reactions) await msg.react(r);
  }

  if (interaction.commandName === "giveaway") {
    const prize = interaction.options.getString("prize");
    const durationStr = interaction.options.getString("duration");
    const ms = parseDuration(durationStr);
    if (!ms) return interaction.reply({ content: "❌ Invalid duration. Use formats like `10m`, `1h`, `1d`.", ephemeral: true });

    const endsAt = Math.floor((Date.now() + ms) / 1000);
    const embed = new EmbedBuilder()
      .setColor(0xF1C40F)
      .setTitle("🎉 GIVEAWAY 🎉")
      .setDescription(`**Prize:** ${prize}\n\nReact with 🎉 to enter!\n\n**Ends:** <t:${endsAt}:R>`)
      .setFooter({ text: `Hosted by ${interaction.user.username}` })
      .setTimestamp(Date.now() + ms);

    const msg = await interaction.reply({ embeds: [embed], fetchReply: true });
    await msg.react("🎉");

    setTimeout(async () => {
      await msg.fetch();
      const reaction = msg.reactions.cache.get("🎉");
      if (!reaction) return;
      const users = await reaction.users.fetch();
      const eligible = users.filter(u => !u.bot);

      const endEmbed = new EmbedBuilder().setTimestamp();
      if (eligible.size === 0) {
        endEmbed.setColor(0xED4245).setTitle("🎉 GIVEAWAY ENDED").setDescription(`**Prize:** ${prize}\n\n😢 No one entered!`);
        await msg.edit({ embeds: [endEmbed] });
      } else {
        const winner = eligible.random();
        endEmbed.setColor(0x57F287).setTitle("🎉 GIVEAWAY ENDED").setDescription(`**Prize:** ${prize}\n\n🏆 **Winner:** <@${winner.id}>\n\nCongratulations!`);
        await msg.edit({ embeds: [endEmbed] });
        await interaction.followUp(`🎉 Congratulations <@${winner.id}>! You won **${prize}**!`);
      }
    }, ms);
  }

  if (interaction.commandName === "8ball") {
    const question = interaction.options.getString("question");
    const responses = [
      "✅ It is certain.", "✅ It is decidedly so.", "✅ Without a doubt.",
      "✅ Yes, definitely.", "✅ Most likely.", "✅ Outlook good.", "✅ Signs point to yes.",
      "🤷 Reply hazy, try again.", "🤷 Ask again later.", "🤷 Cannot predict now.",
      "❌ Don't count on it.", "❌ My reply is no.", "❌ Outlook not so good.", "❌ Very doubtful."
    ];
    const answer = responses[Math.floor(Math.random() * responses.length)];
    await interaction.reply({ embeds: [new EmbedBuilder().setColor(0x5865F2).setTitle("🎱 Magic 8 Ball").addFields({ name: "❓ Question", value: question }, { name: "🎱 Answer", value: answer }).setTimestamp()] });
  }

  if (interaction.commandName === "coinflip") {
    const result = Math.random() < 0.5;
    await interaction.reply({ embeds: [new EmbedBuilder().setColor(result ? 0xF1C40F : 0x95A5A6).setTitle("🪙 Coin Flip").setDescription(result ? "**Heads!**" : "**Tails!**").setTimestamp()] });
  }

  if (interaction.commandName === "dice") {
    const sides = interaction.options.getInteger("sides") || 6;
    const roll = Math.floor(Math.random() * sides) + 1;
    await interaction.reply({ embeds: [new EmbedBuilder().setColor(0x5865F2).setTitle("🎲 Dice Roll").setDescription(`You rolled a **${roll}** out of **${sides}**!`).setTimestamp()] });
  }

  if (interaction.commandName === "setwelcome") {
    if (!interaction.member.permissions.has("ManageGuild"))
      return interaction.reply({ content: "❌ You don't have permission to manage the server.", ephemeral: true });
    const channel = interaction.options.getChannel("channel");
    const message = interaction.options.getString("message") || "Welcome to **{server}**, {user}! 🎉";
    config.set(`welcome_${interaction.guild.id}`, { channelId: channel.id, message });
    await interaction.reply({ embeds: [new EmbedBuilder().setColor(0x57F287).setTitle("✅ Welcome Channel Set").addFields({ name: "Channel", value: `<#${channel.id}>`, inline: true }, { name: "Message", value: message }).setFooter({ text: "Use {user} and {server} as placeholders" }).setTimestamp()] });
  }

  if (interaction.commandName === "autorole") {
    if (!interaction.member.permissions.has("ManageRoles"))
      return interaction.reply({ content: "❌ You don't have permission to manage roles.", ephemeral: true });
    const role = interaction.options.getRole("role");
    config.set(`autorole_${interaction.guild.id}`, role.id);
    await interaction.reply({ embeds: [new EmbedBuilder().setColor(0x57F287).setTitle("✅ Auto Role Set").setDescription(`New members will automatically receive <@&${role.id}> when they join.`).setTimestamp()] });
  }

  if (interaction.commandName === "removewarning") {
    const target = interaction.options.getMember("user");
    const number = interaction.options.getInteger("number");
    if (!target) return interaction.reply({ content: "❌ User not found.", ephemeral: true });
    if (!interaction.member.permissions.has("ModerateMembers"))
      return interaction.reply({ content: "❌ You don't have permission to remove warnings.", ephemeral: true });

    const removed = removeWarning(target.id, number - 1);
    if (!removed) return interaction.reply({ content: `❌ Warning #${number} not found for that member.`, ephemeral: true });

    const record = getWarnings(target.id);
    const remaining = record ? record.warnings.length : 0;

    await interaction.reply({ embeds: [modEmbed(0x57F287, "🗑️ Warning Removed", target.user, [
      { name: "User", value: `<@${target.id}>`, inline: true },
      { name: "Removed Warning #", value: `${number}`, inline: true },
      { name: "Remaining Warnings", value: `${remaining}`, inline: true },
      { name: "Moderator", value: interaction.user.username, inline: true }
    ])] });
  }
});

client.on("messageCreate", async message => {
  if (message.author.bot) return;

  const userId = message.author.id;
  const member = message.member;

  function formatDuration(ms) {
    const totalSeconds = Math.floor(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    if (hours > 0) return `${hours}h ${minutes}m`;
    if (minutes > 0) return `${minutes}m ${seconds}s`;
    return `${seconds}s`;
  }

  if (message.content.toLowerCase().startsWith("!afk")) {
    const reason = message.content.slice(4).trim() || "AFK";
    const now = Date.now();

    afkUsers.set(userId, { reason, since: now });

    const originalName = member?.nickname || message.author.username;
    const newNick = `💤 ${originalName}`.slice(0, 32);

    try {
      await member?.setNickname(newNick);
    } catch {}

    const embed = new EmbedBuilder()
      .setColor(0x5865F2)
      .setAuthor({ name: message.author.username, iconURL: message.author.displayAvatarURL() })
      .setThumbnail(message.author.displayAvatarURL({ size: 128 }))
      .setTitle("💤 Member went AFK")
      .addFields(
        { name: "Reason", value: reason, inline: true },
        { name: "Went AFK", value: `<t:${Math.floor(now / 1000)}:R>`, inline: true }
      )
      .setFooter({ text: "They will be untagged as AFK when they next send a message" })
      .setTimestamp();

    await message.reply({ embeds: [embed] });
    return;
  }

  if (afkUsers.has(userId)) {
    const { since } = afkUsers.get(userId);
    const duration = formatDuration(Date.now() - since);
    const originalName = (member?.nickname || message.author.username).replace(/^💤\s*/, "");

    afkUsers.delete(userId);

    try {
      await member?.setNickname(originalName === message.author.username ? null : originalName);
    } catch {}

    const embed = new EmbedBuilder()
      .setColor(0x57F287)
      .setAuthor({ name: message.author.username, iconURL: message.author.displayAvatarURL() })
      .setTitle("👋 Welcome back!")
      .setDescription(`**${message.author.username}** is no longer AFK.`)
      .addFields({ name: "Was AFK for", value: duration, inline: true })
      .setTimestamp();

    await message.reply({ embeds: [embed] });
  }

  if (message.mentions.users.size > 0) {
    for (const [mentionedId, mentionedUser] of message.mentions.users) {
      if (afkUsers.has(mentionedId)) {
        const { reason, since } = afkUsers.get(mentionedId);
        const duration = formatDuration(Date.now() - since);

        const embed = new EmbedBuilder()
          .setColor(0xFEE75C)
          .setAuthor({ name: mentionedUser.username, iconURL: mentionedUser.displayAvatarURL() })
          .setThumbnail(mentionedUser.displayAvatarURL({ size: 128 }))
          .setTitle("💤 This member is AFK")
          .addFields(
            { name: "Reason", value: reason, inline: true },
            { name: "Went AFK", value: `<t:${Math.floor(since / 1000)}:R>`, inline: true },
            { name: "AFK for", value: duration, inline: true }
          )
          .setFooter({ text: "They will be notified of your mention when they return" })
          .setTimestamp();

        await message.reply({ embeds: [embed] });
      }
    }
  }
});

// ── New member events ────────────────────────────────────────
client.on("guildMemberAdd", async member => {
  const welcomeCfg = config.get(`welcome_${member.guild.id}`);
  if (welcomeCfg) {
    const channel = member.guild.channels.cache.get(welcomeCfg.channelId);
    if (channel) {
      const text = welcomeCfg.message
        .replace("{user}", `<@${member.id}>`)
        .replace("{server}", member.guild.name);
      const embed = new EmbedBuilder()
        .setColor(0x57F287)
        .setTitle("👋 Welcome!")
        .setDescription(text)
        .setThumbnail(member.user.displayAvatarURL({ size: 128 }))
        .setFooter({ text: `Member #${member.guild.memberCount}` })
        .setTimestamp();
      await channel.send({ embeds: [embed] });
    }
  }

  const autoRoleId = config.get(`autorole_${member.guild.id}`);
  if (autoRoleId) {
    try { await member.roles.add(autoRoleId); } catch {}
  }
});

const http = require("http");
http.createServer((req, res) => res.end("Bot is running!")).listen(process.env.PORT || 3000);

client.login(process.env.TOKEN
