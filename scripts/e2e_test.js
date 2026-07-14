// scripts/e2e_test.js
const path = require("path");
const puppeteer = require("puppeteer-core");

const HTML_PATH = path.join(__dirname, "..", "cad_timiza.html");
const CHROMIUM_PATH = "/usr/bin/chromium";

async function main() {
  const browser = await puppeteer.launch({
    executablePath: CHROMIUM_PATH,
    headless: true,
    args: ["--no-sandbox"],
  });

  try {
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", (err) => errors.push(err.message));
    page.on("console", (msg) => { if (msg.type() === "error") errors.push(msg.text()); });

    await page.goto(`file://${HTML_PATH}`);
    await page.waitForSelector("#map");

    const initialCount = await page.evaluate(() => document.getElementById("vehicleList").children.length);
    if (initialCount !== 0) throw new Error(`expected empty vehicle list before click, got ${initialCount}`);

    // Deviation from the task brief: the default speed slider value (50) maps to a
    // 120ms animation tick (speedToIntervalMs), and on the real ~2000-node graph each
    // A* stage explores 300-450+ nodes. That's 35-55s per stage, far past the brief's
    // literal 15000ms waitForFunction budget — a timing-constant mismatch in the spec's
    // worked example, not a bug in dispatchEmergency itself. Nudging the slider to its
    // max (100 -> 20ms/tick) via the real UI control keeps this an end-to-end exercise
    // of the actual app while finishing in well under a minute.
    await page.evaluate(() => {
      const slider = document.getElementById("speedSlider");
      slider.value = "100";
      slider.dispatchEvent(new Event("input"));
    });

    await page.click("#map", { offset: { x: 200, y: 300 } });

    await page.waitForFunction(
      () => document.getElementById("summary").textContent.includes("Tiempo total"),
      { timeout: 30000 }
    );

    const summaryText = await page.evaluate(() => document.getElementById("summary").textContent);
    const listCount = await page.evaluate(() => document.getElementById("vehicleList").children.length);

    // renderVehicleList (app/app.js) writes one div per vehicle with text
    // "<type> #<id>: <cost> min" into #vehicleList, sorted by cost, and marks the
    // dispatched vehicle's div with class "winner". Pull both out of the DOM so we can
    // verify the winner is actually the minimum-cost vehicle, not just that a winner exists.
    const { winnerCost, allCosts } = await page.evaluate(() => {
      const parseCost = (text) => parseFloat(text.split(":")[1]);
      const rows = Array.from(document.getElementById("vehicleList").children);
      const allCosts = rows.map((row) => parseCost(row.textContent));
      const winnerRow = rows.find((row) => row.classList.contains("winner"));
      return { winnerCost: winnerRow ? parseCost(winnerRow.textContent) : null, allCosts };
    });

    await page.screenshot({ path: path.join(__dirname, "..", "build", "e2e_screenshot.png") });

    if (listCount !== 6) throw new Error(`expected 6 vehicles in panel, got ${listCount}`);
    if (errors.length > 0) throw new Error(`console/page errors: ${errors.join("; ")}`);
    if (!/Tiempo total: \d/.test(summaryText)) throw new Error(`summary missing total time: ${summaryText}`);
    if (winnerCost === null) throw new Error("no vehicle row has the winner class");
    if (allCosts.length !== 6) throw new Error(`expected 6 cost values, got ${allCosts.length}`);
    const minCost = Math.min(...allCosts);
    if (Math.abs(winnerCost - minCost) > 1e-9) {
      throw new Error(`winner cost ${winnerCost} is not the minimum among [${allCosts.join(", ")}]`);
    }

    console.log("E2E OK:", summaryText.replace(/\n/g, " | "), `winner cost=${winnerCost} min=${minCost}`);
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error("E2E FAILED:", err);
  process.exit(1);
});
