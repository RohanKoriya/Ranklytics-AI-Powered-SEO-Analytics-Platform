import KeywordTracking from "../models/keywordTracking.js";
import { keywordTracking } from "../services/keywordTrackingService.js";

export const addKeyword = async (req, res) => {
  try {
    const { keyword, url } = req.body;

    // Validation
    if (!keyword || !url) {
      return res
        .status(400)
        .json({ success: false, message: "Keyword and Url are required" });
    }

    /// Normalize URL & extract domain
    let normalizedUrl;
    let domain;
    try {
      normalizedUrl = /^https?:\/\//i.test(url) ? url : `https://${url}`;

      const urlObj = new URL(normalizedUrl);

      domain = urlObj.hostname.replace("www.", "");
    } catch {
      return res
        .status(400)
        .json({ success: false, message: "Invalid url formate" });
    }

    //check if already tracking this keyword+domain
    const existing = await KeywordTracking.findOne({
      userId: req.userId,
      keyword: keyword.toLowerCase().trim(),
      domain
    });

    if (existing) {
      return res
        .status(400)
        .json({ success: false, message: "Already tracking this keyword for this domain" });
    }


    //Create tracking entry
    const tracking = await KeywordTracking.create({
      userId: req.userId,
      keyword: keyword.toLowerCase().trim(),
      url: normalizedUrl,
      domain,
      status: "checking",
      active: true,
    })

    keywordTracking(tracking).catch((err) => {
      console.error(
        "Background tracking error:",
        err.message
      );
    });

    return res.status(201).json({
      success: true,
      message: "Keyword tracking started",
      tracking,
    });

  } catch (error) {
    console.error("Add keyword error: ", error.message);

    // Mongo duplicate key
    if (error.code === 11000) {
      return res.status(400).json({ success: false, message: "Already tracking this keyword" });
    }

    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
}

export const getKeywords = async (req, res) => {
  try {
    const keywords = await KeywordTracking.find({ userId: req.userId }).sort({ createdAt: -1 }).
      select("-rankHistory")
    res.json({ success: true, keywords });
  } catch (error) {
    console.error("Get keywords error:", error.message);
    res.status(500).json({ success: false, message: "Server error" });
  }

}

export const getKeyword = async (req, res) => {
  try {
    const tracking = await KeywordTracking.findOne({ _id: req.params.id, userId: req.userId });
    if (!tracking) return res.status(404).json({
      success: false, message: "Keyword tracking notfound"
    });
    res.json({ success: true, tracking });
  } catch (error) {
    console.error("Get keyword error:", error.message);
    res.status(500).json({ success: false, message: "Server error" });
  }
}

export const refreshKeyword = async (req, res) => {
  try {
    const tracking = await KeywordTracking.findOne({ _id: req.params.id, userId: req.userId });
    if (!tracking) return res.status(404).json({
      success: false, message: "Keyword tracking not found"
    });
    if (tracking.status === "checking") return res.status(409).json({
      success: false, message: "A rank check is already in progress"
    });
    tracking.status = "checking";
    await tracking.save();
    res.json({ success: true, message: "Rank check started" });
    keywordTracking(tracking).catch((err) => {
      console.error(
        "Background tracking error:",
        err.message
      );
    });
  } catch (error) {
    console.error("Refresh keyword error:", error.message);
    res.status(500).json({ success: false, message: "Server error" });
  }
}

export const deleteKeyword = async (req, res) => {
  try {
    const tracking = await KeywordTracking.findOneAndDelete({
      _id: req.params.id,
      userId: req.userId,
    });
    if (!tracking) return res.status(404).json({
      success: false, message: "Keyword tracking not found"
    });

    res.json({ success: true, message: "Keyword tracking deleted" });

  } catch (error) {
    console.error("Delete keyword error:", error.message);
    res.status(500).json({ success: false, message: "Server error" });
  }
}

export const toggleTracking = async (req, res) => {
  try {
    const tracking = await KeywordTracking.findOne({ _id: req.params.id, userId: req.userId });
    if (!tracking) return res.status(404).json({
      success: false, message: "Keyword tracking not found"
    });

    tracking.active = !tracking.active;
    await tracking.save();

    res.json({ success: true, tracking });

  } catch (error) {
    console.error("Toggle tracking error:", error.message);
    res.status(500).json({ success: false, message: "Server error" });
  }
}