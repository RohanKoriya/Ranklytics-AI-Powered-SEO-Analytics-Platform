import { chromium } from "playwright-core";
import Browserbase from "@browserbasehq/sdk";

const bb = new Browserbase({
  apiKey: process.env.BROWSERBASE_API_KEY,
});

function normalizeDomain(value) {
  try {
    const hostname = new URL(
      /^https?:\/\//i.test(value) ? value : `https://${value}`
    ).hostname;
    return hostname.replace(/^www\./i, "").toLowerCase();
  } catch {
    return value.replace(/^www\./i, "").toLowerCase();
  }
}

async function resolveResultUrl(context, href) {
  try {
    const url = new URL(href);
    const redirectedUrl = url.searchParams.get("q") || url.searchParams.get("url");

    if (redirectedUrl && /^https?:\/\//i.test(redirectedUrl)) {
      return redirectedUrl;
    }

    if (!url.hostname.endsWith("google.com")) {
      return /^https?:$/i.test(url.protocol) ? url.href : null;
    }

    const redirectPage = await context.newPage();
    try {
      await redirectPage.goto(url.href, {
        waitUntil: "commit",
        timeout: 10000,
      });
      const resolvedUrl = new URL(redirectPage.url());
      return resolvedUrl.hostname.endsWith("google.com")
        ? null
        : /^https?:$/i.test(resolvedUrl.protocol)
          ? resolvedUrl.href
          : null;
    } finally {
      await redirectPage.close().catch(() => { });
    }
  } catch {
    return null;
  }
}

// Search Google for keyword and track ranking
export async function rankTracker(keyword, targetDomain) {
  let browser;

  try {
    // Create Browserbase session
    const session = await bb.sessions.create({
      browserSettings: {
        blockAds: true,
      },
    });

    // Connect Playwright to Browserbase
    browser = await chromium.connectOverCDP(session.connectUrl);

    const defaultContext = browser.contexts()[0];
    const page = defaultContext.pages()[0];

    page.setDefaultNavigationTimeout(45000);

    // Open Google
    await page.goto("https://www.google.com/", {
      waitUntil: "networkidle",
    });

    // Handle Google consent popup
    try {
      const btn = await page.$(
        'button[id="L2AGLb"], form[action*="consent"] button'
      );

      if (btn) {
        await btn.click();
        await page.waitForTimeout(1500);
      }
    } catch (error) {
      console.log("Consent popup not found");
    }

    let found = null;

    let allResults = [];

    const cleanTarget = normalizeDomain(targetDomain);

    const isTargetDomain = (domain) => {
      const cleanDomain = normalizeDomain(domain);
      return cleanDomain === cleanTarget || cleanDomain.endsWith(`.${cleanTarget}`);
    };

    // Search through first 5 Google pages
    for (let gPage = 0; gPage < 5; gPage++) {
      const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(
        keyword
      )}&start=${gPage * 10}&num=10&hl=en&gl=us`;

      await page.goto(searchUrl, {
        // Google keeps analytics and streaming requests open, so networkidle
        // can time out even when the result page is ready to scrape.
        waitUntil: "domcontentloaded",
      });

      let pageResults = [];

      // Retry extraction 3 times
      for (let retry = 0; retry < 3; retry++) {
        try {
          await page.waitForSelector("h3", {
            timeout: 8000,
          });

          await page.waitForTimeout(1500);

          pageResults = await page.evaluate(() => {
            return Array.from(document.querySelectorAll("h3"))
              .map((h3) => {
                let a = h3.closest("a");

                // Find anchor if not directly linked
                if (!a) {
                  let p = h3.parentElement;

                  for (
                    let j = 0;
                    j < 5 && p;
                    j++, p = p.parentElement
                  ) {
                    if (p.tagName === "A") {
                      a = p;
                      break;
                    }

                    const sub = p.querySelector("a[href]");

                    if (sub && sub.contains(h3)) {
                      a = sub;
                      break;
                    }
                  }
                }

                if (!a) {
                  return null;
                }

                let snippet = "";

                let c = a.parentElement;

                for (
                  let j = 0;
                  j < 6 && c;
                  j++, c = c.parentElement
                ) {
                  const txt = c.innerText || "";

                  if (
                    txt.length >
                    h3.innerText.length + 50
                  ) {
                    snippet = (
                      txt
                        .split("\n")
                        .find(
                          (line) =>
                            line.length > 30 &&
                            !line.includes(
                              h3.innerText.substring(0, 20)
                            )
                        ) || ""
                    )
                      .trim()
                      .substring(0, 300);

                    if (snippet) break;
                  }
                }

                return {
                  href: a.href,
                  title: h3.innerText.trim(),
                  snippet,
                };
              })
              .filter(Boolean);
          });

          pageResults = (await Promise.all(
            pageResults.map(async (result) => {
              const resultUrl = await resolveResultUrl(defaultContext, result.href);
              if (!resultUrl) return null;

              return {
                url: resultUrl,
                domain: normalizeDomain(resultUrl),
                title: result.title,
                snippet: result.snippet,
              };
            })
          )).filter(Boolean);

          if (pageResults.length > 0) {
            break;
          }

          await page.reload({
            waitUntil: "domcontentloaded",
          });
        } catch (error) {
          if (retry === 2) break;

          await page.reload({
            waitUntil: "domcontentloaded",
          });
        }
      }

      // Stop if no results
      if (!pageResults.length) {
        break;
      }

      // Process results
      for (const r of pageResults) {
        r.position = allResults.length + 1;

        allResults.push(r);

        // Check if target found
        if (
          !found &&
          isTargetDomain(r.domain)
        ) {
          found = {
            ...r,
            page: gPage + 1,
          };
        }
      }

      // Human-like delay
      await page.waitForTimeout(
        2000 + Math.random() * 2000
      );

      // Stop searching if found
      if (found) break;
    }

    // Close browser
    await browser.close();

    // Competitor extraction
    const competitors = allResults
      .filter(
        (r) =>
          !isTargetDomain(r.domain)
      )
      .slice(0, 10);

    // Final response
    return {
      success: true,
      data: {
        keyword,
        targetDomain,
        position: found?.position || null,
        page: found?.page || null,
        title: found?.title || "",
        snippet: found?.snippet || "",
        competitors,
        totalResultsScanned: allResults.length,
      },
    };
  } catch (error) {
    console.error(
      "Rank check error:",
      error.message
    );

    if (browser) {
      await browser.close().catch(() => { });
    }

    return {
      success: false,
      error: error.message,
    };
  }
}