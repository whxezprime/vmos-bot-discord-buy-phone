const { chromium } = require('playwright');
const Mailjs = require("@cemalgnlts/mailjs");
const axios = require('axios');
const CryptoJS = require('crypto-js');

// ================= CẤU HÌNH =================
const VMOS_REGISTER_URL = 'https://cloud.vmoscloud.com/register'; // Link đăng ký thực tế
const VMOS_LOGIN_URL = 'https://cloud.vmoscloud.com/login'; 
const USER_PASSWORD = 'Truong@123456'; // Mật khẩu bạn muốn cài cho user
const TIME_OUT = 60000; // 60 giây chờ OTP

// ================= 1. HÀM LẤY EMAIL VÀ OTP =================
async function createTempEmailAndGetOTP() {
    const mailjs = new Mailjs();
    console.log("⏳ Đang tạo email tạm thời...");
    const account = await mailjs.createOneAccount();
    const email = account.data.address;
    const pass = account.data.password;
    console.log(`✅ Đã tạo email: ${email}`);

    await mailjs.login(email, pass);
    return { mailjs, email };
}

async function waitForOTP(mailjs) {
    console.log("⏳ Đang chờ email chứa mã OTP từ VMOS...");
    const startTime = Date.now();
    
    while (Date.now() - startTime < TIME_OUT) {
        const messages = await mailjs.getMessages();
        for (const msg of messages) {
            // Tìm chuỗi 4-6 chữ số trong tiêu đề hoặc nội dung email
            const match = msg.subject.match(/\d{4,6}/) || msg.intro.match(/\d{4,6}/);
            if (match) {
                console.log(`✅ Đã tìm thấy OTP: ${match[0]}`);
                return match[0];
            }
        }
        await new Promise(r => setTimeout(r, 3000)); // Chờ 3s kiểm tra lại
    }
    throw new Error("❌ Hết thời gian chờ OTP. Có thể VMOS chặn email tạm thời.");
}

// ================= 2. HÀM TỰ ĐỘNG ĐĂNG KÝ WEB =================
async function autoRegisterVMOS(browser, email, otp) {
    const page = await browser.newPage();
    console.log("🌐 Đang truy cập trang đăng ký VMOS...");
    
    // Chặn tải hình ảnh để bot chạy nhanh hơn
    await page.route('**/*.{png,jpg,jpeg,svg}', route => route.abort());

    await page.goto(VMOS_REGISTER_URL, { waitUntil: 'networkidle' });

    try {
        // CẢNH BÁO: Các selector dưới đây cần được cập nhật bằng F12
        console.log("📝 Đang điền form đăng ký...");
        await page.fill('input[type="text"][placeholder*="mail"]', email); 
        await page.fill('input[type="password"]', USER_PASSWORD); 
        
        // --- XỬ LÝ CAPTCHA TẠI ĐÂY ---
        // Nếu có Captcha (ví dụ Cloudflare Turnstile hoặc reCAPTCHA):
        // const captchaToken = await solveCaptchaWith2Captcha(page.url());
        // await page.evaluate((token) => { document.getElementById('captcha-response').value = token; }, captchaToken);
        // -----------------------------

        // Click nút Đăng ký
        await page.click('button[type="submit"]');
        
        // Chờ trang chuyển sang form nhập OTP
        console.log("📨 Đang chờ form nhập OTP...");
        await page.waitForSelector('input[placeholder*="OTP"], input[placeholder*="mã xác nhận"]', { timeout: 15000 });
        
        // Điền OTP
        await page.fill('input[placeholder*="OTP"], input[placeholder*="mã xác nhận"]', otp);
        await page.click('button[type="submit"]');

        // Chờ vào Dashboard
        console.log("⏳ Chờ vào trang quản trị...");
        await page.waitForURL('**/dashboard**', { timeout: 20000 });
        console.log("✅ Đăng ký & Đăng nhập thành công!");

        // --- LẤY API KEY ĐỂ TẠO MÁY ---
        console.log("🔑 Đang lấy API Key...");
        // Bạn cần F12 xem trang quản lý API của VMOS nằm ở đâu
        await page.goto('https://cloud.vmoscloud.com/dashboard/api-keys', { waitUntil: 'networkidle' }); 
        
        // Giả sử API key hiển thị trên trang (Bạn cần tự F12 để sửa selector)
        // const accessKey = await page.locator('.access-key-class').innerText();
        // const secretKey = await page.locator('.secret-key-class').innerText();
        
        // Do không rõ giao diện thực tế, mình sẽ trả về key giả định. 
        // Bạn phải thay bằng logic cào dữ liệu thực tế ở trên.
        const accessKey = "YOUR_EXTRACTED_ACCESS_KEY"; 
        const secretKey = "YOUR_EXTRACTED_SECRET_KEY";

        return { accessKey, secretKey };
    } catch (error) {
        console.error("❌ Lỗi trong quá trình đăng ký:", error.message);
        await page.screenshot({ path: 'error_register.png' }); // Chụp ảnh màn hình lúc lỗi để debug
        throw error;
    } finally {
        await page.close();
    }
}

// ================= 3. HÀM GỌI API TẠO MÁY ẢO =================
async function createTrialInstance(accessKey, secretKey) {
    console.log("🚀 Đang gọi API để mua máy ảo Trial...");
    const API_HOST = 'https://api.vmoscloud.com';
    const path = '/vcpcloud/api/padApi/create_instance';
    const body = JSON.stringify({ image: 'android-12', count: 1 });
    const timestamp = Math.floor(Date.now() / 1000).toString();

    // Tạo chữ ký (Cần check lại tài liệu VMOS xem dùng HMAC-SHA256 hay SHA256)
    const signString = secretKey + timestamp + path + body;
    const sign = CryptoJS.HmacSHA256(signString, secretKey).toString(CryptoJS.enc.Hex);

    try {
        const response = await axios.post(`${API_HOST}${path}`, body, {
            headers: {
                'X-Access-Key': accessKey,
                'X-Timestamp': timestamp,
                'X-Sign': sign,
                'Content-Type': 'application/json'
            }
        });
        console.log('✅ Tạo máy ảo thành công:', response.data);
        return response.data; 
    } catch (error) {
        console.error('❌ Lỗi tạo máy ảo:', error.response?.data || error.message);
        return null;
    }
}

// ================= 4. LUỒNG CHẠY CHÍNH =================
(async () => {
    let browser;
    try {
        console.log("=== BẮT ĐẦU QUY TRÌNH TẠO ACC GAME TREO ===");
        
        // Bước 1: Lấy Email
        const { mailjs, email } = await createTempEmailAndGetOTP();

        // Bước 2: Mở trình duyệt
        browser = await chromium.launch({ 
            headless: false, // Để false để bạn xem bot thao tác, khi chạy thật thì đổi thành true
            args: ['--disable-blink-features=AutomationControlled'] // Tránh bị phát hiện là bot
        });

        // Bước 3: Đăng ký tài khoản & Lấy OTP
        // (Hàm này sẽ đứng chờ cho đến khi có OTP trong mail)
        const otpPromise = waitForOTP(mailjs);
        
        // Vì bước đăng ký cần OTP, nên ta phải chờ form web hiện ra trước, 
        // nhưng Playwright chạy bất đồng bộ. Ta sẽ cho chạy song song.
        // Tuy nhiên, cách an toàn nhất là:
        // 1. Điền email -> 2. Bấm Đăng ký -> 3. Đợi OTP -> 4. Điền OTP
        
        const page = await browser.newPage();
        await page.goto(VMOS_REGISTER_URL, { waitUntil: 'domcontentloaded' });
        
        // Điền email và pass
        await page.fill('input[placeholder*="mail"]', email);
        await page.fill('input[type="password"]', USER_PASSWORD);
        await page.click('button[type="submit"]'); // Bấm đăng ký

        // Chờ lấy OTP từ mail
        const otp = await otpPromise;

        // Điền OTP
        await page.waitForSelector('input[placeholder*="OTP"]', { timeout: 20000 });
        await page.fill('input[placeholder*="OTP"]', otp);
        await page.click('button[type="submit"]');

        // Chờ vào Dashboard
        await page.waitForURL('**/dashboard**', { timeout: 20000 });
        console.log("✅ Đăng ký thành công!");

        // (Tại đây, nếu muốn đổi mật khẩu thành mật khẩu user yêu cầu, bạn dùng page.goto('.../profile') và thao tác)

        // Bước 4: Lấy API Key
        // ... (Phần cào API Key như đã nói ở trên)
        const accessKey = "KEY_CUA_BAN"; 
        const secretKey = "SECRET_CUA_BAN";

        // Bước 5: Tạo máy ảo
        if (accessKey !== "KEY_CUA_BAN") {
            await createTrialInstance(accessKey, secretKey);
            console.log(`🎉 HOÀN TẤT! Tài khoản: ${email} | Pass: ${USER_PASSWORD}`);
        } else {
            console.log(`⚠️ Đã tạo xong acc: ${email} | Pass: ${USER_PASSWORD}. Nhưng chưa lấy được API Key để tạo máy.`);
        }

    } catch (error) {
        console.error("❌ Lỗi luồng chính:", error);
    } finally {
        if (browser) await browser.close();
    }
})();
