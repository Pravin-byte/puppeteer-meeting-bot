// server.js
const express = require('express');
const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');
require('dotenv').config();

const app = express();
app.use(express.json());

async function ensureChrome() {
  const chromePath = '/tmp/chrome/chrome-linux64/chrome';
  if (fs.existsSync(chromePath)) return chromePath;

  console.log('⬇️ Downloading Chrome at runtime...');
  execSync('npx puppeteer browsers install chrome', {
    env: { ...process.env, PUPPETEER_CACHE_DIR: '/tmp/chrome' },
    stdio: 'inherit',
  });

  if (!fs.existsSync(chromePath)) {
    throw new Error('Chrome installation failed.');
  }
  return chromePath;
}

app.post('/join-meeting', async (req, res) => {
  const { link, token } = req.body;

  if (token !== process.env.SECRET) {
    return res.status(403).json({ error: 'Unauthorized' });
  }

  if (!link || !link.startsWith('http')) {
    return res.status(400).json({ error: 'Invalid or missing meeting link' });
  }

  let browser;
  try {
    const chromePath = await ensureChrome();

    browser = await puppeteer.launch({
      headless: true,
      executablePath: chromePath,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 720 });

    const platform = detectPlatform(link);
    console.log(`🔍 Detected platform: ${platform}`);

    let joined = false;
    if (platform === 'Google Meet') {
      joined = await joinGoogleMeet(page, link);
    } else if (platform === 'Zoom') {
      joined = await joinZoom(page, link);
    } else if (platform === 'Jitsi') {
      joined = await joinJitsi(page, link);
    } else if (platform === 'Microsoft Teams') {
      joined = await joinTeams(page, link);
    } else if (platform === 'Webex') {
      joined = await joinWebex(page, link);
    } else {
      throw new Error(`Platform ${platform} not supported yet.`);
    }

    const stayDuration = parseInt(process.env.STAY_DURATION || '60000');
    await page.waitForTimeout(stayDuration);
    await browser.close();

    return res.json({
      status: joined ? 'joined' : 'failed',
      platform,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    if (browser) await browser.close();
    console.error('❌ Error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

function detectPlatform(link) {
  if (link.includes('meet.google.com')) return 'Google Meet';
  if (link.includes('zoom.us')) return 'Zoom';
  if (link.includes('jit.si')) return 'Jitsi';
  if (link.includes('teams.microsoft.com')) return 'Microsoft Teams';
  if (link.includes('webex.com')) return 'Webex';
  return 'Unknown';
}

async function joinGoogleMeet(page, link) {
  console.log('🔗 Joining Google Meet...');
  await page.goto(link, { waitUntil: 'networkidle2' });
  console.log('📍 Landed on:', page.url());

  if (process.env.GMAIL && process.env.GPASSWORD) {
    try {
      await page.waitForSelector('input[type="email"]', { timeout: 15000 });
      await page.type('input[type="email"]', process.env.GMAIL);
      await page.click('#identifierNext');
      await page.waitForTimeout(3000);
      await page.waitForSelector('input[type="password"]', { timeout: 15000 });
      await page.type('input[type="password"]', process.env.GPASSWORD);
      await page.click('#passwordNext');
      await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 20000 });
      console.log('✅ Logged in to Google');
    } catch (e) {
      console.warn('⚠️ Google login skipped or failed:', e.message);
    }
  }

  try {
    await page.waitForSelector('div[role="button"]', { timeout: 15000 });
    await page.evaluate(() => {
      const buttons = [...document.querySelectorAll('div[role="button"]')];
      const joinBtn = buttons.find(btn => btn.innerText && btn.innerText.toLowerCase().includes('join'));
      if (joinBtn) joinBtn.click();
    });
    console.log('✅ Clicked Join Button');
  } catch (e) {
    console.warn('⚠️ Could not click Join:', e.message);
  }

  try {
    await page.waitForSelector('button[aria-label*="Leave call"]', { timeout: 15000 });
    console.log('✅ Join confirmed (in meeting)');
    return true;
  } catch (e) {
    console.warn('⚠️ Could not confirm join:', e.message);
    return false;
  }
}

async function joinZoom(page, link) {
  console.log('🔗 Joining Zoom...');
  await page.goto(link, { waitUntil: 'networkidle2' });
  await page.waitForTimeout(4000);
  const joinFromBrowser = await page.$('a[href*="/wc/join/"]');
  if (joinFromBrowser) {
    await joinFromBrowser.click();
    await page.waitForTimeout(3000);
    const input = await page.$('input#inputname');
    if (input) await input.type('PuppeteerBot');
    const joinBtn = await page.$('button[type="submit"]');
    if (joinBtn) await joinBtn.click();
    console.log('✅ Joined Zoom from browser');
    return true;
  } else {
    console.warn('⚠️ Zoom: "Join from browser" link not found');
    return false;
  }
}

async function joinJitsi(page, link) {
  console.log('🔗 Joining Jitsi...');
  await page.goto(link, { waitUntil: 'networkidle2' });
  await page.waitForTimeout(2000);
  console.log('✅ Joined Jitsi Meet');
  return true;
}

async function joinTeams(page, link) {
  console.log('🔗 Joining Microsoft Teams...');
  await page.goto(link, { waitUntil: 'networkidle2' });
  try {
    await page.click('button#acceptButton', { timeout: 5000 }).catch(() => {});
    await page.waitForSelector('a.use-app-lnk', { timeout: 15000 });
    await page.click('a.use-app-lnk');
    await page.waitForSelector('input#username', { timeout: 15000 });
    await page.type('input#username', 'PuppeteerBot');
    await page.click('button[type="submit"]');
    console.log('✅ Joined Teams meeting');
    return true;
  } catch (e) {
    console.error('❌ Teams join failed:', e.message);
    return false;
  }
}

async function joinWebex(page, link) {
  console.log('🔗 Joining Webex...');
  await page.goto(link, { waitUntil: 'networkidle2' });
  try {
    await page.waitForSelector('input[name="guestName"]', { timeout: 15000 });
    await page.type('input[name="guestName"]', 'PuppeteerBot');
    await page.click('button.joinMeeting');
    console.log('✅ Joined Webex meeting');
    return true;
  } catch (e) {
    console.error('❌ Webex join failed:', e.message);
    return false;
  }
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Puppeteer bot server listening on port ${PORT}`));
