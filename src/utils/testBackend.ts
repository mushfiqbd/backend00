import axios from 'axios';

const BASE_URL = 'http://localhost:3000';

async function testBackend() {
  console.log('🧪 Testing Autotrade Sentinel Backend...\n');

  try {
    // Test 1: Health check
    console.log('1. Testing health check endpoint...');
    const healthResponse = await axios.get(`${BASE_URL}/health`);
    console.log('✅ Health check:', (healthResponse.data as any).status);
    
    // Test 2: Register new user
    console.log('\n2. Testing user registration...');
    const registerData = {
      email: 'test@example.com',
      password: 'password123'
    };
    
    try {
      const registerResponse = await axios.post(`${BASE_URL}/api/auth/register`, registerData);
      console.log('✅ Registration successful');
      console.log('   User ID:', (registerResponse.data as any).data.user.id);
      console.log('   Token:', (registerResponse.data as any).data.token.substring(0, 20) + '...');
    } catch (error: any) {
      if (error.response?.status === 409) {
        console.log('⚠️  User already exists, proceeding with login...');
      } else {
        throw error;
      }
    }
    
    // Test 3: Login
    console.log('\n3. Testing user login...');
    const loginResponse = await axios.post(`${BASE_URL}/api/auth/login`, registerData);
    const token = (loginResponse.data as any).data.token;
    console.log('✅ Login successful');
    console.log('   Token:', token.substring(0, 20) + '...');
    
    // Test 4: Get profile with auth
    console.log('\n4. Testing profile endpoint with authentication...');
    const profileResponse = await axios.get(`${BASE_URL}/api/auth/profile`, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });
    console.log('✅ Profile fetch successful');
    console.log('   User email:', (profileResponse.data as any).data.user.email);
    console.log('   Trading mode:', (profileResponse.data as any).data.settings.trading_mode);
    
    // Test 5: Get settings
    console.log('\n5. Testing settings endpoint...');
    const settingsResponse = await axios.get(`${BASE_URL}/api/settings`, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });
    console.log('✅ Settings fetch successful');
    console.log('   Settings ID:', (settingsResponse.data as any).data.id);
    
    // Test 6: Update settings
    console.log('\n6. Testing settings update...');
    const updateResponse = await axios.put(`${BASE_URL}/api/settings`, 
      { trading_mode: 'real' },
      {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      }
    );
    console.log('✅ Settings update successful');
    console.log('   New trading mode:', (updateResponse.data as any).data.trading_mode);
    
    console.log('\n🎉 All tests passed! Backend is working correctly.');
    
  } catch (error: any) {
    console.error('❌ Test failed:', error.message);
    if (error.response) {
      console.error('   Status:', error.response.status);
      console.error('   Data:', error.response.data);
    }
  }
}

// Run tests if this file is executed directly
if (require.main === module) {
  testBackend();
}

export default testBackend;