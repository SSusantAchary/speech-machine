import { test, expect } from "@playwright/test";

test("login -> record -> save -> session", async ({ page }) => {
  await page.addInitScript(() => {
    (window as { __disableFaceLandmarker?: boolean }).__disableFaceLandmarker = true;
    navigator.mediaDevices.getUserMedia = async () => new MediaStream();

    class MockMediaRecorder {
      stream: MediaStream;
      ondataavailable: ((event: { data: Blob }) => void) | null = null;
      onstop: (() => void) | null = null;
      constructor(stream: MediaStream) {
        this.stream = stream;
      }
      start() {
        const blob = new Blob(["test"], { type: "video/webm" });
        if (this.ondataavailable) {
          this.ondataavailable({ data: blob });
        }
      }
      requestData() {}
      stop() {
        if (this.onstop) {
          this.onstop();
        }
      }
      pause() {}
      resume() {}
    }

    (window as unknown as { MediaRecorder: typeof MediaRecorder }).MediaRecorder = MockMediaRecorder as any;
  });

  await page.route("**/auth/login", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ access_token: "fake-token" }),
    });
  });

  await page.route("**/sessions", async (route) => {
    if (route.request().method() === "POST") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ id: 1 }),
      });
      return;
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([]) });
  });

  await page.route("**/sessions/1/upload**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ status: "complete" }),
    });
  });

  await page.route("**/sessions/1/transcribe", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ status: "queued" }) });
  });

  await page.route("**/sessions/1", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: 1,
        title: "Interview practice",
        mode: "Interview",
        duration_ms: 1000,
        wpm_avg: 120,
        filler_count: 0,
        eye_contact_pct: 0.8,
        transcription_status: "complete",
        transcript_segments: [{ id: 1, start_ms: 0, end_ms: 1000, text: "Hello" }],
        metrics: [],
        score: { total: 80, speech: 30, delivery: 25, content: 25, topFixes: [], recommendedDrill: "Pace" },
      }),
    });
  });

  await page.goto("/login");
  await page.getByPlaceholder("Email or username").fill("demo@demo.com");
  await page.getByPlaceholder("Password").fill("secret123");
  await page.getByRole("button", { name: "Sign in" }).click();

  await page.getByRole("link", { name: "Start session" }).click();

  const recordButton = page.locator("button").filter({ has: page.locator("div.h-8.w-8") });
  await recordButton.click();
  await page.waitForTimeout(200);
  await recordButton.click();

  await page.getByRole("button", { name: "Save session" }).click();
  await expect(page).toHaveURL(/\/session\/1/);
  await expect(page.getByText("Transcript")).toBeVisible();
});
