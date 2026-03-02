# New Supabase Project Setup Guide

##🚀 Steps to Create New Supabase Project

### 1. Create New Supabase Project
1. Go to [Supabase Dashboard](https://app.supabase.com/)
2. Click "New Project"
3. Choose your organization
4. Enter project name (e.g., "autotrade-sentinel-backend")
5. Select region closest to your users
6. Set a strong database password
7. Click "Create Project"

### 2. Get Connection Details
After project is created:
1. Go to Settings → Database
2. Copy the "Connection string" 
3. It should look like: `postgresql://postgres:[PASSWORD]@[PROJECT_ID].supabase.co:5432/postgres`

### 3. Update Backend Configuration
Update your `.env` file with the new connection details:

```env
DATABASE_URL=postgresql://postgres:YOUR_NEW_PASSWORD@YOUR_NEW_PROJECT_ID.supabase.co:5432/postgres
```

### 4. Run Database Migration
```bash
cd backend
npm run migrate
```

### 5. Test the Connection
```bash
npm run test:db
```

### 6. Start the Backend
```bash
npm run dev
```

##📋 What This Setup Provides

✅ **Fresh Database**: Clean database with all required tables
✅ **Custom Authentication**: Your own JWT-based auth system
✅ **Full Control**: Complete control over API logic
✅ **Supabase Benefits**: Managed PostgreSQL with all features
✅ **No Data Migration**: Start fresh without worrying about existing data

##🔧 Schema Includes

- `users` - Custom user authentication
- `app_settings` - Trading mode and webhook settings
- `api_keys` - Exchange API key storage
- `risk_settings` - Trading risk configuration
- `trades` - Trade execution history
- `positions` - Active position tracking
- `demo_balances` - Demo trading balances
- `webhook_events` - Webhook event logging
- `exchange_symbol_info` - Exchange symbol information

##🛡️ Security Features

- Row Level Security (RLS) policies
- Proper foreign key constraints
- Indexes for performance
- Automatic timestamp updates
- Unique constraints where needed

## 🎯 Next Steps After Setup

1. Test user registration/login
2. Verify database operations
3. Test API endpoints
4. Connect frontend to new backend
5. Deploy to production

The backend is ready to work with your new Supabase project!