const { 
    Client, 
    GatewayIntentBits,
    ActivityType,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    Events,
    EmbedBuilder,
    InteractionResponseType,
    PermissionsBitField
} = require('discord.js');

require('dotenv').config();
const fs = require('fs').promises;
const path = require('path');

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

const MEMORY_FILE = path.join(__dirname, 'memory-logs-verify.txt');
const WHITELIST_FILE = path.join(__dirname, '..', 'DLX_SERVER', 'Whitelist.json');
const VERIFY_ROLE_ID = '1255222180548182030'; // Role ที่จะให้

// แก้ไข Event name
client.once(Events.ClientReady, async () => {
    console.log(`${client.user.tag} is online!`);

    client.user.setActivity("กำลังสตรีม!", {
        type: ActivityType.Streaming,
        url: "https://www.twitch.tv/lofigirl"
    });

    // ส่งปุ่ม + รูปภาพไปที่ห้อง
    const channelId = '1419937082297679954';

    try {
        const channel = await client.channels.fetch(channelId);

        if (!channel) {
            console.log('❌ ไม่พบห้องนี้');
            return;
        }

        const button = new ButtonBuilder()
            .setCustomId('open_modal')
            .setLabel('VERIFY')
            .setStyle(ButtonStyle.Primary);

        const row = new ActionRowBuilder().addComponents(button);

        const embed = new EmbedBuilder()
            .setTitle('DULUX BOXING VERIFYING')
            .setDescription('โปรดกรอกข้อมูลของท่านเพื่อยืนยันตัวตน ก่อนเข้าถึงระบบเกม')
            .setImage('https://i.ibb.co/Z1YcdmxM/DULUX.png')
            .setColor('#0099ff'); // เพิ่มสี

        await channel.send({ embeds: [embed], components: [row] });
        console.log('✅ ส่งข้อความยืนยันตัวตนแล้ว');

    } catch (error) {
        console.error('❌ เกิดข้อผิดพลาดในการส่งข้อความ:', error);
    }
});

// ฟังก์ชันโหลดไฟล์ memory logs
async function loadMemoryLogs() {
    try {
        const data = await fs.readFile(MEMORY_FILE, 'utf-8');
        return data;
    } catch (err) {
        if (err.code === 'ENOENT') {
            console.log("⚠ ไม่พบไฟล์ memory logs");
            return '';
        } else {
            console.error("❌ ไม่สามารถโหลด memory logs:", err);
            return '';
        }
    }
}

// ฟังก์ชันโหลดไฟล์ Whitelist.json - แก้ไขการจัดการ JSON error
async function loadWhitelist() {
    try {
        const data = await fs.readFile(WHITELIST_FILE, 'utf-8');

        // ตรวจสอบว่าไฟล์ว่างหรือไม่
        if (!data.trim()) {
            console.log("⚠ ไฟล์ Whitelist.json ว่าง - สร้างใหม่");
            await saveWhitelist([]);
            return [];
        }

        // พยายาม parse JSON
        try {
            const parsed = JSON.parse(data);
            // ตรวจสอบว่าเป็น array หรือไม่
            if (Array.isArray(parsed)) {
                return parsed;
            } else {
                console.log("⚠ Whitelist.json ไม่ใช่ array - สร้างใหม่");
                await saveWhitelist([]);
                return [];
            }
        } catch (parseError) {
            console.error("❌ JSON parse error:", parseError.message);
            console.log("🔧 กำลังสำรองข้อมูลเก่าและสร้างใหม่...");

            // สำรองไฟล์เก่า
            const backupFile = WHITELIST_FILE + `.backup.${Date.now()}`;
            await fs.writeFile(backupFile, data, 'utf-8');
            console.log(`💾 สำรองข้อมูลไว้ที่: ${backupFile}`);

            // สร้างไฟล์ใหม่
            await saveWhitelist([]);
            return [];
        }

    } catch (err) {
        if (err.code === 'ENOENT') {
            console.log("⚠ ไม่พบไฟล์ Whitelist.json - สร้างใหม่");
            await saveWhitelist([]);
            return [];
        } else {
            console.error("❌ ไม่สามารถโหลด Whitelist.json:", err);
            return [];
        }
    }
}

// ฟังก์ชันบันทึกไฟล์ Whitelist.json - เพิ่มการตรวจสอบ
async function saveWhitelist(list) {
    try {
        // ตรวจสอบว่า list เป็น array
        if (!Array.isArray(list)) {
            console.error("❌ ข้อมูล whitelist ต้องเป็น array");
            throw new Error("Whitelist data must be an array");
        }

        // สร้างโฟลเดอร์ถ้ายังไม่มี
        const dir = path.dirname(WHITELIST_FILE);
        await fs.mkdir(dir, { recursive: true });

        // เขียนไฟล์พร้อมตรวจสอบ JSON
        const jsonString = JSON.stringify(list, null, 2);
        await fs.writeFile(WHITELIST_FILE, jsonString, 'utf-8');

        console.log(`✅ บันทึก Whitelist.json สำเร็จ (${list.length} รายการ)`);
    } catch (err) {
        console.error("❌ ไม่สามารถบันทึก Whitelist.json:", err);
        throw err;
    }
}

// ฟังก์ชันตรวจสอบว่าผู้ใช้ยืนยันแล้วหรือไม่
async function isUserAlreadyVerified(userId) {
    try {
        const whitelist = await loadWhitelist();
        return whitelist.some(user => user.discordId === userId);
    } catch (err) {
        console.error("❌ เกิดข้อผิดพลาดในการตรวจสอบการยืนยัน:", err);
        return false; // ถ้าเกิดข้อผิดพลาด ให้อนุญาตให้ยืนยันได้
    }
}

// ฟังก์ชันตรวจสอบ permissions ของ bot
function checkBotPermissions(guild, botMember) {
    const permissions = {
        manageNicknames: botMember.permissions.has(PermissionsBitField.Flags.ManageNicknames),
        manageRoles: botMember.permissions.has(PermissionsBitField.Flags.ManageRoles)
    };

    console.log(`🔍 Bot Permissions Check:
        - Manage Nicknames: ${permissions.manageNicknames ? '✅' : '❌'}
        - Manage Roles: ${permissions.manageRoles ? '✅' : '❌'}`);

    return permissions;
}

client.on(Events.InteractionCreate, async interaction => {
    // จัดการปุ่ม Verify
    if (interaction.isButton() && interaction.customId === 'open_modal') {
        // ตรวจสอบว่าผู้ใช้ยืนยันแล้วหรือไม่
        const isVerified = await isUserAlreadyVerified(interaction.user.id);

        if (isVerified) {
            await interaction.reply({
                content: "✅ คุณได้ยืนยันตัวตนแล้ว ไม่จำเป็นต้องยืนยันอีกครั้ง",
                flags: 64 // InteractionResponseFlags.Ephemeral
            });
            return;
        }

        const modal = new ModalBuilder()
            .setCustomId('secret_modal')
            .setTitle('DULUX BOXING VERIFYING');

        const usernameInput = new TextInputBuilder()
            .setCustomId('username')
            .setLabel('USERNAME ROBLOX')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('กรอก USERNAME ของคุณ ตัวอย่าง (REWARZ_TH)')
            .setRequired(true)
            .setMaxLength(50);

        const secretInput = new TextInputBuilder()
            .setCustomId('secret')
            .setLabel('กรอก VERIFY CODE ของคุณ')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('กรอก VERIFY CODE ของคุณ ตัวอย่าง (FJSDIOEHWKJSF)')
            .setRequired(true)
            .setMaxLength(100);

        modal.addComponents(
            new ActionRowBuilder().addComponents(usernameInput),
            new ActionRowBuilder().addComponents(secretInput)
        );

        await interaction.showModal(modal);
    }

    // จัดการ Modal Submit
    if (interaction.isModalSubmit() && interaction.customId === 'secret_modal') {
        const username = interaction.fields.getTextInputValue('username').trim();
        const secret = interaction.fields.getTextInputValue('secret').trim();

        // ตรวจสอบข้อมูลพื้นฐาน
        if (!username || !secret) {
            await interaction.reply({
                content: "❌ กรุณากรอกข้อมูลให้ครบถ้วน",
                flags: 64 // InteractionResponseFlags.Ephemeral
            });
            return;
        }

        // ตรวจสอบว่าผู้ใช้ยืนยันแล้วหรือไม่
        const isVerified = await isUserAlreadyVerified(interaction.user.id);

        if (isVerified) {
            await interaction.reply({
                content: "✅ คุณได้ยืนยันตัวตนแล้ว ไม่สามารถยืนยันอีกครั้งได้",
                flags: 64 // InteractionResponseFlags.Ephemeral
            });
            return;
        }

        try {
            console.log(`🔍 กำลังตรวจสอบ: Username=${username}, Secret=${secret}`);

            // โหลดไฟล์ memory logs
            const data = await loadMemoryLogs();

            if (!data) {
                await interaction.reply({
                    content: "❌ ไม่สามารถอ่านข้อมูลจากระบบได้ กรุณาติดต่อแอดมิน",
                    flags: 64 // InteractionResponseFlags.Ephemeral
                });
                return;
            }

            // หาบรรทัดที่ตรงกัน (ปรับการค้นหาให้แม่นยำขึ้น)
            const lines = data.split('\n').filter(line => line.trim() !== '');
            console.log(`📊 พบ ${lines.length} บรรทัดในไฟล์ memory logs`);

            // Debug: แสดงบรรทัดแรกๆ เพื่อตรวจสอบรูปแบบ
            console.log(`🔍 ตัวอย่างบรรทัดแรก:`, lines.slice(0, 3));

            const lineMatch = lines.find(line => {
                const usernameMatch = line.includes(`Username: ${username}`);
                const secretMatch = line.includes(`Secret: ${secret}`);
                console.log(`🔍 ตรวจสอบบรรทัด: ${line.substring(0, 100)}... | Username: ${usernameMatch} | Secret: ${secretMatch}`);
                return usernameMatch && secretMatch;
            });

            if (lineMatch) {
                console.log('✅ พบข้อมูลที่ตรงกัน:', lineMatch);

                // โหลด whitelist เดิม
                const whitelist = await loadWhitelist();

                // ตรวจสอบว่า Roblox username นี้ถูกใช้แล้วหรือไม่
                const robloxExists = whitelist.some(user => 
                    user.robloxName && user.robloxName.toLowerCase() === username.toLowerCase()
                );

                if (robloxExists) {
                    await interaction.reply({
                        content: "❌ Roblox Username นี้ถูกใช้ยืนยันแล้ว กรุณาใช้ Username อื่น",
                        flags: 64 // InteractionResponseFlags.Ephemeral
                    });
                    return;
                }

                // เพิ่มข้อมูลใหม่
                const newUser = {
                    discordId: interaction.user.id,
                    discordName: interaction.user.username,
                    robloxName: username,
                    verifiedAt: new Date().toISOString(),
                };

                whitelist.push(newUser);
                await saveWhitelist(whitelist);

                // ดึงข้อมูล member
                const member = await interaction.guild.members.fetch(interaction.user.id);
                const botMember = await interaction.guild.members.fetch(client.user.id);

                // ตรวจสอบ permissions
                const permissions = checkBotPermissions(interaction.guild, botMember);

                let roleSuccess = false;
                let nicknameSuccess = false;

                // ให้ role
                if (permissions.manageRoles) {
                    try {
                        await member.roles.add(VERIFY_ROLE_ID);
                        console.log(`✅ ให้ role สำเร็จ: ${interaction.user.username}`);
                        roleSuccess = true;
                    } catch (roleError) {
                        console.error('❌ ไม่สามารถให้ role:', roleError);
                    }
                } else {
                    console.log('⚠ Bot ไม่มีสิทธิ์ Manage Roles');
                }

                // เปลี่ยนชื่อ (ตรวจสอบ permissions และ role hierarchy)
                if (permissions.manageNicknames) {
                    try {
                        const newName = `${interaction.user.username} (@${username})`;

                        // ตรวจสอบความยาวของชื่อ
                        if (newName.length <= 32) {
                            // ตรวจสอบ role hierarchy - bot ต้องมี role สูงกว่าผู้ใช้
                            const botHighestRole = botMember.roles.highest;
                            const userHighestRole = member.roles.highest;

                            if (botHighestRole.position > userHighestRole.position) {
                                await member.setNickname(newName);
                                console.log(`✅ เปลี่ยนชื่อสำเร็จ: ${newName}`);
                                nicknameSuccess = true;
                            } else {
                                console.log('⚠ Bot role ต้องสูงกว่า user role เพื่อเปลี่ยนชื่อได้');
                            }
                        } else {
                            console.log(`⚠ ชื่อใหม่ยาวเกิน 32 ตัวอักษร: ${newName.length}`);
                        }
                    } catch (nicknameError) {
                        console.error('❌ ไม่สามารถเปลี่ยนชื่อ:', nicknameError);
                    }
                } else {
                    console.log('⚠ Bot ไม่มีสิทธิ์ Manage Nicknames');
                }

                // สร้างข้อความตอบกลับ
                let responseMessage = `✅ **ยืนยันสำเร็จ!** \n━━━━━━━━━━━━━━━━━━━━\n👤 **Discord:** ${interaction.user.username}\n🎮 **Roblox:** ${username}\n⏰ **เวลา:** <t:${Math.floor(Date.now() / 1000)}:F>\n━━━━━━━━━━━━━━━━━━━━`;

                // เพิ่มข้อมูลสถานะการทำงาน
                const statusItems = [];
                statusItems.push(roleSuccess ? '✅ ได้รับ Role แล้ว' : '⚠ ไม่สามารถให้ Role ได้');
                statusItems.push(nicknameSuccess ? '✅ เปลี่ยนชื่อแล้ว' : '⚠ ไม่สามารถเปลี่ยนชื่อได้');

                responseMessage += `\n\n📋 **สถานะ:**\n${statusItems.join('\n')}\n━━━━━━━━━━━━━━━━━━━━\n🎉 คุณได้รับสิทธิ์เข้าใช้งานแล้ว!`;

                await interaction.reply({
                    content: responseMessage,
                    flags: 64 // InteractionResponseFlags.Ephemeral
                });

                console.log(`✅ ยืนยันสำเร็จ: ${interaction.user.username} -> ${username} (Role: ${roleSuccess}, Nickname: ${nicknameSuccess})`);

            } else {
                console.log(`❌ ไม่พบข้อมูล: Username=${username}, Secret=${secret}`);

                await interaction.reply({
                    content: "❌ **ไม่พบข้อมูลในระบบ**\n━━━━━━━━━━━━━━━━━━━━\n🔍 กรุณาตรวจสอบ:\n• Username Roblox ต้องถูกต้อง\n• Verify Code ต้องถูกต้อง\n• ตัวพิมพ์ใหญ่-เล็ก\n━━━━━━━━━━━━━━━━━━━━\n📞 หากยังไม่ได้ กรุณาติดต่อแอดมิน",
                    flags: 64 // InteractionResponseFlags.Ephemeral
                });
            }

        } catch (err) {
            console.error("❌ เกิดข้อผิดพลาดขณะตรวจสอบ:", err);
            await interaction.reply({
                content: "⚠ **เกิดข้อผิดพลาด**\nกรุณาลองใหม่อีกครั้ง หรือติดต่อแอดมิน",
                flags: 64 // InteractionResponseFlags.Ephemeral
            });
        }
    }
});

// Error handling
client.on('error', error => {
    console.error('❌ Client Error:', error);
});

process.on('uncaughtException', error => {
    console.error('❌ Uncaught Exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
});

client.login(process.env.DISCORD_TOKEN).catch(err => {
    console.error('❌ ไม่สามารถเข้าสู่ระบบได้:', err);
});