class TikTokAdsIntegration:
    """TikTok Ads & TikTok Events API integration isolated per brand_id."""

    def build_916_video_ad_payload(
        self,
        brand_id: str,
        advertiser_id: str,
        campaign_name: str,
        daily_budget_usd: float,
        video_public_https_url: str,
    ) -> dict:
        return {
            "brand_id": brand_id,
            "advertiser_id": advertiser_id,
            "campaign_name": campaign_name,
            "objective_type": "LEAD_GENERATION",
            "budget_mode": "BUDGET_MODE_DAY",
            "budget_usd": round(float(daily_budget_usd), 2),
            "placement_type": "PLACEMENT_TIKTOK_9_16",
            "video_url": video_public_https_url,
        }
