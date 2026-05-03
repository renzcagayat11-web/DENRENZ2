// Verify Cloudinary credentials
require('dotenv').config({ path: './server/.env' });

console.log('🔍 Verifying Cloudinary credentials...\n');

// Check current credentials
const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
const apiKey = process.env.CLOUDINARY_API_KEY;
const apiSecret = process.env.CLOUDINARY_API_SECRET;

console.log('📋 Current credentials:');
console.log(`Cloud Name: "${cloudName}" (length: ${cloudName ? cloudName.length : 0})`);
console.log(`API Key: "${apiKey}" (length: ${apiKey ? apiKey.length : 0})`);
console.log(`API Secret: "${apiSecret}" (length: ${apiSecret ? apiSecret.length : 0})`);

console.log('\n📏 Expected lengths:');
console.log('- Cloud Name: 3-30 characters (letters, numbers, hyphens)');
console.log('- API Key: 12-15 digits');
console.log('- API Secret: 40+ characters (alphanumeric)');

console.log('\n✅ Validation:');
console.log(`Cloud Name: ${cloudName && cloudName.length >= 3 && cloudName.length <= 30 ? '✅ Valid length' : '❌ Invalid length'}`);
console.log(`API Key: ${apiKey && /^\d{12,15}$/.test(apiKey) ? '✅ Valid format' : '❌ Invalid format'}`);
console.log(`API Secret: ${apiSecret && apiSecret.length >= 40 ? '✅ Valid length' : '❌ Too short'}`);

// Test Cloudinary connection
if (cloudName && apiKey && apiSecret) {
  console.log('\n🌐 Testing Cloudinary connection...');
  
  try {
    const cloudinary = require('cloudinary').v2;
    
    cloudinary.config({
      cloud_name: cloudName,
      api_key: apiKey,
      api_secret: apiSecret
    });
    
    cloudinary.api.ping()
      .then(result => {
        console.log('✅ Cloudinary connection successful!');
        console.log('Response:', result);
      })
      .catch(error => {
        console.error('❌ Cloudinary connection failed:');
        console.error('Error:', error.message);
        
        if (error.http_code === 401) {
          console.error('🔧 This means either:');
          console.error('   - Cloud name is incorrect');
          console.error('   - API key is incorrect'); 
          console.error('   - API secret is incorrect');
        }
      });
      
  } catch (error) {
    console.error('❌ Error setting up Cloudinary:', error.message);
  }
} else {
  console.log('\n❌ Cannot test connection - missing credentials');
}

console.log('\n💡 If you have new credentials from your new Cloudinary account:');
console.log('1. Cloud name: From dashboard URL (e.g., myproject123)');
console.log('2. API Key: 12-15 digit number');
console.log('3. API Secret: 40+ character string');
console.log('4. Update the .env file with these exact values');
