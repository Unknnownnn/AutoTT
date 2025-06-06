import os
import json

def get_credentials_dict():
    """Get Google OAuth credentials from environment variables"""
    client_id = os.getenv('GOOGLE_CLIENT_ID')
    client_secret = os.getenv('GOOGLE_CLIENT_SECRET')
    project_id = os.getenv('GOOGLE_PROJECT_ID')
    
    if not all([client_id, client_secret, project_id]):
        raise ValueError("Missing required Google OAuth credentials in environment variables")
    
    return {
        "installed": {
            "client_id": client_id,
            "project_id": project_id,
            "auth_uri": "https://accounts.google.com/o/oauth2/auth",
            "token_uri": "https://oauth2.googleapis.com/token",
            "auth_provider_x509_cert_url": "https://www.googleapis.com/oauth2/v1/certs",
            "client_secret": client_secret,
            "redirect_uris": ["http://localhost"]
        }
    }

def ensure_credentials_file(credentials_dir=None):
    """Ensure credentials.json exists using environment variables"""
    if credentials_dir is None:
        credentials_dir = os.path.dirname(os.path.abspath(__file__))
    
    credentials_path = os.path.join(credentials_dir, 'credentials.json')
    
    # Only create credentials.json if it doesn't exist
    if not os.path.exists(credentials_path):
        try:
            credentials = get_credentials_dict()
            with open(credentials_path, 'w') as f:
                json.dump(credentials, f)
            return True
        except Exception as e:
            print(f"Error creating credentials.json: {str(e)}")
            return False
    
    return True 