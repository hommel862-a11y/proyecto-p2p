class YouTubeDataV3Integration:
    """YouTube Data API v3 Shorts upload builder isolated per brand_id."""

    def build_shorts_upload_payload(
        self,
        brand_id: str,
        channel_id: str,
        title: str,
        description: str,
        campaign_id: str,
        ad_id: str,
    ) -> dict:
        short_title = title if "#Shorts" in title else f"{title} #Shorts"
        attributed_desc = (
            f"{description}\n\n"
            f"Atribución: utm_source=youtube_shorts&utm_campaign={campaign_id}&ad_id={ad_id}"
        )
        return {
            "brand_id": brand_id,
            "channel_id": channel_id,
            "snippet": {
                "title": short_title[:100],
                "description": attributed_desc,
                "categoryId": "22",
            },
            "status": {
                "privacyStatus": "public",
                "selfDeclaredMadeForKids": False,
            },
        }
