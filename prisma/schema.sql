-- Database schema for Autotrade Sentinel
-- This schema mirrors the existing Supabase schema with some modifications

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create users table (replaces Supabase auth.users)
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Create app settings table
CREATE TABLE app_settings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL UNIQUE,
    trading_mode TEXT NOT NULL DEFAULT 'demo' CHECK (trading_mode IN ('demo', 'real')),
    webhook_secret TEXT NOT NULL DEFAULT md5(uuid_generate_v4()::text),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Create API keys table
CREATE TABLE api_keys (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL,
    exchange TEXT NOT NULL CHECK (exchange IN ('binance', 'bybit')),
    api_key TEXT NOT NULL,
    api_secret TEXT NOT NULL,
    is_testnet BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    UNIQUE (user_id, exchange, is_testnet)
);

-- Create risk settings table
CREATE TABLE risk_settings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL,
    exchange TEXT NOT NULL DEFAULT 'default' CHECK (exchange IN ('default', 'binance', 'bybit')),
    symbol TEXT NOT NULL DEFAULT '__DEFAULT__',
    size_type TEXT NOT NULL DEFAULT 'equity_percent' CHECK (size_type IN ('fixed_usdt', 'equity_percent', 'risk_percent')),
    size_value DECIMAL NOT NULL DEFAULT 1.0,
    leverage INTEGER NOT NULL DEFAULT 10,
    margin_mode TEXT NOT NULL DEFAULT 'cross' CHECK (margin_mode IN ('cross', 'isolated')),
    max_position_usdt DECIMAL,
    max_daily_trades INTEGER,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    UNIQUE (user_id, exchange, symbol)
);

-- Create trades table
CREATE TABLE trades (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL,
    exchange TEXT NOT NULL,
    symbol TEXT NOT NULL,
    side TEXT NOT NULL CHECK (side IN ('buy', 'sell')),
    order_type TEXT NOT NULL DEFAULT 'market',
    quantity DECIMAL NOT NULL,
    price DECIMAL,
    leverage INTEGER DEFAULT 1,
    mode TEXT NOT NULL CHECK (mode IN ('demo', 'real')),
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'queued', 'executed', 'filled', 'failed', 'cancelled', 'ignored', 'not_executed')),
    order_id TEXT,
    error_message TEXT,
    webhook_payload JSONB,
    executed_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Create positions table
CREATE TABLE positions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL,
    exchange TEXT NOT NULL,
    symbol TEXT NOT NULL,
    side TEXT NOT NULL CHECK (side IN ('long', 'short')),
    entry_price DECIMAL NOT NULL,
    quantity DECIMAL NOT NULL,
    leverage INTEGER DEFAULT 1,
    unrealized_pnl DECIMAL DEFAULT 0,
    mode TEXT NOT NULL CHECK (mode IN ('demo', 'real')),
    state TEXT NOT NULL DEFAULT 'OPEN' CHECK (state IN ('PENDING_ENTRY', 'OPEN', 'CLOSING', 'CLOSED')),
    opened_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    UNIQUE (user_id, exchange, symbol, mode)
);

-- Create demo balances table
CREATE TABLE demo_balances (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL,
    exchange TEXT NOT NULL,
    asset TEXT NOT NULL DEFAULT 'USDT',
    balance DECIMAL NOT NULL DEFAULT 10000,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    UNIQUE (user_id, exchange, asset)
);

-- Create webhook events table
CREATE TABLE webhook_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL,
    event_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    symbol TEXT,
    exchange TEXT,
    strategy_id TEXT,
    payload JSONB,
    processed_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Create exchange symbol info table
CREATE TABLE exchange_symbol_info (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    exchange TEXT NOT NULL,
    symbol TEXT NOT NULL,
    is_testnet BOOLEAN NOT NULL DEFAULT false,
    tick_size DECIMAL NOT NULL,
    step_size DECIMAL NOT NULL,
    min_notional DECIMAL NOT NULL,
    min_qty DECIMAL NOT NULL,
    max_qty DECIMAL,
    max_leverage INTEGER,
    is_tradable BOOLEAN NOT NULL DEFAULT true,
    status TEXT,
    cached_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    UNIQUE (exchange, symbol, is_testnet)
);

-- Create indexes for better performance
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_app_settings_user_id ON app_settings(user_id);
CREATE INDEX idx_api_keys_user_id ON api_keys(user_id);
CREATE INDEX idx_risk_settings_user_id ON risk_settings(user_id);
CREATE INDEX idx_trades_user_id ON trades(user_id);
CREATE INDEX idx_trades_created_at ON trades(created_at);
CREATE INDEX idx_positions_user_id ON positions(user_id);
CREATE INDEX idx_positions_state ON positions(state);
CREATE INDEX idx_webhook_events_user_id ON webhook_events(user_id);
CREATE INDEX idx_webhook_events_created_at ON webhook_events(created_at);
CREATE INDEX idx_exchange_symbol_info_exchange_symbol ON exchange_symbol_info(exchange, symbol);

-- Create function to update updated_at columns
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Create triggers for automatic timestamp updates
CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_app_settings_updated_at BEFORE UPDATE ON app_settings
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_api_keys_updated_at BEFORE UPDATE ON api_keys
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_risk_settings_updated_at BEFORE UPDATE ON risk_settings
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_positions_updated_at BEFORE UPDATE ON positions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_demo_balances_updated_at BEFORE UPDATE ON demo_balances
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_exchange_symbol_info_updated_at BEFORE UPDATE ON exchange_symbol_info
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Insert default data for a test user (optional)
-- INSERT INTO users (id, email, password_hash) VALUES 
-- (uuid_generate_v4(), 'test@example.com', '$2a$10$example_hash');

-- INSERT INTO app_settings (user_id, trading_mode) 
-- SELECT id, 'demo' FROM users WHERE email = 'test@example.com';

-- INSERT INTO demo_balances (user_id, exchange, asset, balance) 
-- SELECT id, 'binance', 'USDT', 10000 FROM users WHERE email = 'test@example.com';

-- INSERT INTO demo_balances (user_id, exchange, asset, balance) 
-- SELECT id, 'bybit', 'USDT', 10000 FROM users WHERE email = 'test@example.com';