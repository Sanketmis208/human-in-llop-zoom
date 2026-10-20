# Create a Zoom Marketplace app with the App Manifest API

This guide shows how to create a Zoom Team Chatbot app using the **App Manifest API**.

### Set local developer env with Ngrok 

For local development, this sample uses reverse proxy to tunnel traffic to this application via https.

```
ngrok http 3000
```

Ngrok will output the origin it has created for your tunnel, eg https://9a20-38-99-100-7.ngrok.io. You'll need to use the https origin from the Ngrok terminal output or what tunnel service of your when testing locally. In the pre-defined configuration, replace all instances of `example.ngrok.app` with your actual ngrok domain.


Please copy the https origin from the Ngrok terminal output and paste it in the ZOOM_REDIRECT_URI value in the .env file

---
### Create and configure Marketplace App

### 1. Create an OAuth app

👉 **[Click here to create an app on the Zoom App Marketplace](https://marketplace.zoom.us/develop/create)**

* Select **General app** and click **Create**.

> [!NOTE]
> Take note of your app ID in the URL after app creation -- you will need it to later on.
---

### 2. Retrieve app credentials

* Click **Manage** > your app
* Navigate to **Basic Information** > **App Credentials**

> [!Note]
> Use these credentials for [authorization](https://developers.zoom.us/docs/integrations/oauth/).

---

### 3. Add required scopes

 On the Scope page, select the following:
  * Create apps: marketplace:write:app
  * View an app: marketplace:read:app

### 4. Update the app using the Manifest API

Use the following endpoint to quickly configure a Zoom Marketplace app:

**Example request:**

```
PUT /marketplace/apps/{appId}/manifest
```
👉 [Update an app by manifest API endpoint](https://developers.zoom.us/docs/api/marketplace/#tag/manifest/put/marketplace/apps/{appId}/manifest)

---

### 5. Use Manifest JSON object to create Zoom App
 Use an API tool like Postman to send a PUT request to the manifest endpoint with the JSON object below as the request body.

> [!NOTE]
> Replace placeholder URLs like `https://example.ngrok.io` with your actual tunnel URL (e.g., from ngrok).

**Request body:**

```json
{
    "manifest": {
        "display_information": {
            "display_name": "Zoom Workplace Chatbot"
        },
        "oauth_information": {
            "usage": "USER_OPERATION",
            "development_redirect_uri": "https://example.ngrok.app",
            "production_redirect_uri": "",
            "oauth_allow_list": [
                "https://example.ngrok.app",
                "https://oauth.pstmn.io/v1/callback"
            ],
            "strict_mode": false,
            "subdomain_strict_mode": false,
            "scopes": [
                {
                    "scope": "imchat:userapp",
                    "optional": false
                },
                {
                    "scope": "marketplace:read:app",
                    "optional": false
                },
                {
                    "scope": "marketplace:write:app",
                    "optional": false
                }
            ]
        },
        "features": {
            "products": [
                "ZOOM_CHAT"
            ],
            "development_home_uri": "",
            "production_home_uri": "",
            "in_client_feature": {
                "zoom_app_api": {
                    "enable": false,
                    "zoom_app_apis": []
                },
                "guest_mode": {
                    "enable": false,
                    "enable_test_guest_mode": false
                },
                "in_client_oauth": {
                    "enable": false
                },
                "collaborate_mode": {
                    "enable": false,
                    "enable_screen_sharing": false,
                    "enable_play_together": false,
                    "enable_start_immediately": false,
                    "enable_join_immediately": false
                }
            },
            "zoom_client_support": {
                "mobile": {
                    "enable": false
                },
                "zoom_room": {
                    "enable": false,
                    "enable_personal_zoom_room": false,
                    "enable_shared_zoom_room": false,
                    "enable_digital_signage": false,
                    "enable_zoom_rooms_controller": false
                },
                "pwa_client": {
                    "enable": false
                }
            },
            "embed": {
                "meeting_sdk": {
                    "enable": false,
                    "enable_device": false,
                    "devices": []
                },
                "contact_center_sdk": {
                    "enable": false
                },
                "phone_sdk": {
                    "enable": false
                }
            },
            "team_chat_subscription": {
                "enable": true,
                "enable_support_channel": false,
                "slash_command": {
                    "command": "",
                    "command_hints": [],
                    "enable_add_to_channel": false,
                    "development_message_url": "https://example.ngrok.app/anthropic",
                    "production_message_url": "",
                    "sender_type": "zoom",
                    "welcome_msg": {
                        "title": "",
                        "body": ""
                    },
                    "trust_domain_list": []
                },
                "shortcuts": []
            },
            "event_subscription": {
                "enable": false,
                "events": []
            }
        }
    }
}
```