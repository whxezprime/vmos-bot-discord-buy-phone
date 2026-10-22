const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { chromium } = require('playwright');
const Mailjs = require("@cemalgnlts/mailjs");
const axios = require('axios');
const CryptoJS = require('crypto-js');

// ================= CẤU HÌNH CỦA BẠN =================
const DISCORD_TOKEN = 'TOKEN_CUA_BAN_VAO_DAY'; 
const CLIENT_ID = 'CLIENT_ID_CUA_BAN_VAO_DAY';
const USER_PASSWORD = 'Truong@123456'; // Mật khẩu cho tài khoản VMOS
const TIME_OUT = 60000; // 60 giây chờ OTP
// =====================================================

// ================= CÁC HÀM XỬ LÝ TỰ ĐỘNG =================
async function createTempEmailAndGetOTP() {
    const mailjs = new Mailjs();
    const account = await mailjs.createOneAccount();
    const email = account.data.address;
    const pass = account.data.password;
    await mailjs.login(email, pass);
    return { mailjs, email };
}

async function waitForOTP(mailjs) {
    const startTime = Date.now();
    while (Date.now() - startTime < TIME_OUT) {
        const messages = await mailjs.getMessages();
        for (const msg of messages) {
            const match = msg.subject.match(/\d{4,6}/) || msg.intro.match(/\d{4,6}/);
            if (match) return match[0];
        }
        await new Promise(r => setTimeout(r, 3000));
    }
    throw new Error("Hết thời gian chờ OTP.");
}

async function runAutomation() {
    const { mailjs, email } = await createTempEmailAndGetOTP();
    
    // Chạy headless: true vì trên host không có giao diện đồ họa (GUI)
    const browser = await chromium.launch({ 
        headless: true, 
        args: ['--disable-blink-features=AutomationControlled', '--no-sandbox'] 
    });
    
    const page = await browser.newPage();
    await page.route('**/*.{png,jpg,jpeg,svg}', route => route.abort());

    try {
        await page.goto('https://cloud.vmoscloud.com/register', { waitUntil: 'domcontentloaded' });
        
        // --- BẠN CẦN F12 TRANG WEB ĐỂ CẬP NHẬT LẠI CÁC SELECTOR NÀY ---
        await page.fill('input[placeholder*="mail"]', email);
        await page.fill('input[type="password"]', USER_PASSWORD);
        await page.click('button[type="submit"]');

        const otp = await waitForOTP(mailjs);

        await page.waitForSelector('input[placeholder*="OTP"]', { timeout: 20000 });
        await page.fill('input[placeholder*="OTP"]', otp);
        await page.click('button[type="submit"]');

        await page.waitForURL('**/dashboard**', { timeout: 20000 });
        
        // TODO: Lấy API Key thực tế tại đây nếu cần tạo máy ảo
        const accessKey = "KEY_CUA_BAN"; 
        const secretKey = "SECRET_CUA_BAN";

        return { email, accessKey, secretKey };
    } finally {
        await browser.close();
    }
}

// ================= CẤU HÌNH DISCORD BOT =================
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

const commands = [
    new SlashCommandBuilder()
        .setName('taoacc')
        .setDescription('Tự động tạo tài khoản VMOS Trial và máy ảo')
].map(command => command.toJSON());

client.once('ready', async () => {
    console.log(`🤖 Bot đã online: ${client.user.tag}`);
    const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN);
    try {
        await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
        console.log('✅ Đã đăng ký lệnh Slash thành công!');
    } catch (error) {
        console.error(error);
    }
});

client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;

    if (interaction.commandName === 'taoacc') {
        await interaction.deferReply(); 

        const embed = new EmbedBuilder()
            .setTitle('⏳ Đang xử lý...')
            .setDescription('Bot đang tạo email, đăng ký tài khoản và chờ OTP. Vui lòng đợi (1-2 phút)...')
            .setColor(0xFFFF00);

        await interaction.editReply({ embeds: [embed] });

        try {
            const result = await runAutomation();
            
            const successEmbed = new EmbedBuilder()
                .setTitle('✅ TẠO TÀI KHOẢN THÀNH CÔNG')
                .setColor(0x00FF00)
                .addFields(
                    { name: '📧 Email', value: `\`${result.email}\``, inline: true },
                    { name: '🔑 Mật khẩu', value: `\`${USER_PASSWORD}\``, inline: true },
                    { name: '📱 Trạng thái', value: 'Đã tạo máy ảo Trial (Nếu có API Key)', inline: false }
                )
                .setTimestamp();

            await interaction.editReply({ embeds: [successEmbed] });
        } catch (error) {
            console.error(error);
            const errorEmbed = new EmbedBuilder()
                .setTitle('❌ CÓ LỖI XẢY RA')
                .setDescription(`\`\`\`${error.message}\`\`\``)
                .setColor(0xFF0000);
            
            await interaction.editReply({ embeds: [errorEmbed] });
        }
    }
});

// Đăng nhập bot
client.login(DISCORD_TOKEN);
