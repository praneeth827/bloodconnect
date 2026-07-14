# Security Guidelines

## ⚠️ Important: Before Pushing to GitHub

This repository should **NEVER** contain:
- API keys
- OAuth client secrets
- JWT secrets
- Database files
- Uploaded user documents
- Environment variable files (`.env`)

## Setup Instructions

### 1. Environment Variables

**Never commit `.env` file!** Always use `.env.example` as a template.

1. Copy `.env.example` to `.env`:
   ```bash
   cp .env.example .env
   ```

2. Edit `.env` and replace all placeholder values with your actual secrets:
   ```env
   PORT=3001
   JWT_SECRET=your_actual_jwt_secret_here
   SESSION_SECRET=your_actual_session_secret_here
   GOOGLE_CLIENT_ID=your_actual_google_client_id
   GOOGLE_CLIENT_SECRET=your_actual_google_client_secret
   GOOGLE_CALLBACK_URL=http://localhost:3001/api/auth/google/callback
   GOOGLE_MAPS_API_KEY=your_actual_google_maps_api_key
   ```

3. Generate strong secrets:
   - Use a password generator or run: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
   - Never use default or example values in production

### 2. Google Maps API Key

1. Open `index.html`
2. Find the line: `const GOOGLE_MAPS_API_KEY = 'YOUR_GOOGLE_MAPS_API_KEY_HERE';`
3. Replace `YOUR_GOOGLE_MAPS_API_KEY_HERE` with your actual Google Maps API key

**Note:** For production, consider using environment variables or a backend endpoint to serve the API key securely.

### 3. Google OAuth Setup

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select existing
3. Enable Google+ API
4. Create OAuth 2.0 credentials
5. Add authorized redirect URI: `http://localhost:3001/api/auth/google/callback`
6. Copy Client ID and Client Secret to your `.env` file

## Files That Are Automatically Ignored

The `.gitignore` file ensures these are never committed:
- `.env` and all environment files
- `node_modules/`
- `data/*.sqlite` (database files)
- `uploads/` (uploaded documents)
- Log files and temporary files

## If You Accidentally Committed Secrets

If you accidentally pushed secrets to GitHub:

1. **Immediately rotate/revoke the exposed secrets:**
   - Generate new JWT_SECRET
   - Generate new SESSION_SECRET
   - Revoke and regenerate Google OAuth credentials
   - Regenerate Google Maps API key

2. **Remove from Git history:**
   ```bash
   git filter-branch --force --index-filter \
     "git rm --cached --ignore-unmatch .env" \
     --prune-empty --tag-name-filter cat -- --all
   ```

3. **Force push (⚠️ Warning: This rewrites history):**
   ```bash
   git push origin --force --all
   ```

4. **Better approach:** Use GitHub's secret scanning feature to detect and remove secrets automatically.

## Best Practices

1. ✅ Always use `.env.example` as a template
2. ✅ Never commit `.env` files
3. ✅ Use strong, randomly generated secrets
4. ✅ Rotate secrets regularly
5. ✅ Use different secrets for development and production
6. ✅ Review `.gitignore` before committing
7. ✅ Use GitHub's secret scanning alerts

## Production Deployment

For production:
- Use environment variables provided by your hosting platform
- Never hardcode secrets in code
- Use secure secret management services (AWS Secrets Manager, Azure Key Vault, etc.)
- Enable HTTPS/SSL
- Set up proper CORS policies
- Use rate limiting
- Regularly update dependencies

## Reporting Security Issues

If you discover a security vulnerability, please report it responsibly:
1. Do not open a public issue
2. Contact the repository maintainer privately
3. Provide details about the vulnerability
4. Allow time for the issue to be fixed before public disclosure

