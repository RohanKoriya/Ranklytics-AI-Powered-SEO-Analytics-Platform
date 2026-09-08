import { rankTracker } from "./rankTrackerService.js";

export async function keywordTracking(tracking) {
  try {
    let result = null;

    // Retry logic
    for (let attempt = 1; attempt <= 2; attempt++) {
      result = await rankTracker(
        tracking.keyword,
        tracking.domain
      );

      if (result.success && result.data.totalResultsScanned > 0) {
        break;
      }

      // Wait before retry
      if (attempt < 2) {
        await new Promise((resolve) =>
          setTimeout(
            resolve,
            result.success ? 3000 : 5000
          )
        );
      }
    }

    const hasResults = result?.success && result.data.totalResultsScanned > 0;

    // Only persist a completed check when Google returned extractable results.
    if (hasResults) {
      const previousPosition =
        tracking.currentPosition;

      // Normalize today's date
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      // Update tracking data
      tracking.currentPosition = result.data.position;

      tracking.currentPage = result.data.page;

      tracking.competitors = result.data.competitors;

      tracking.lastChecked = new Date();

      tracking.status = "completed";

      // Position change calculation
      tracking.positionChange = previousPosition !== null && previousPosition !== undefined && result.data.position !== null && result.data.position !== undefined
        ? previousPosition - result.data.position
        : 0;

      // Best position update
      if (
        result.data.position &&
        (!tracking.bestPosition ||
          result.data.position <
          tracking.bestPosition)
      ) {
        tracking.bestPosition =
          result.data.position;
      }

      // Create history entry
      const historyEntry = {
        date: today,
        position: result.data.position,
        page: result.data.page,
        title: result.data.title,
        snippet: result.data.snippet,
      };

      // Check if today's entry exists
      const existingIndex =
        tracking.rankHistory.findIndex(
          (h) =>
            new Date(h.date).toDateString() ===
            today.toDateString()
        );

      // Update or insert history
      if (existingIndex >= 0) {
        tracking.rankHistory[existingIndex] =
          historyEntry;
      } else {
        tracking.rankHistory.push(
          historyEntry
        );
      }
    } else {
      tracking.status = "failed";
    }

    // Save changes
    await tracking.save();

    return result;
  } catch (error) {
    console.error(
      "Rank update error:",
      error.message
    );

    tracking.status = "failed";

    await tracking.save().catch(() => { });

    return {
      success: false,
      error: error.message,
    };
  }
}