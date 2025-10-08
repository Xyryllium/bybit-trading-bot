#!/usr/bin/env node

/**
 * DNS Configuration Helper for ISP blocks
 * Forces Node.js to use Google DNS (8.8.8.8, 8.8.4.4) or Cloudflare DNS (1.1.1.1)
 */

import dns from 'dns';
import { promisify } from 'util';

const dnsResolve = promisify(dns.resolve4);

// Configure DNS servers
const DNS_SERVERS = {
  google: ['8.8.8.8', '8.8.4.4'],
  cloudflare: ['1.1.1.1', '1.0.0.1'],
  quad9: ['9.9.9.9', '149.112.112.112'],
};

/**
 * Setup DNS to bypass ISP blocks
 */
export function setupDNS(provider = 'google') {
  const servers = DNS_SERVERS[provider] || DNS_SERVERS.google;
  
  console.log(`🔧 Setting DNS servers to: ${provider.toUpperCase()} (${servers.join(', ')})`);
  
  // Set DNS servers for Node.js
  dns.setServers(servers);
  
  return servers;
}

/**
 * Test DNS resolution
 */
export async function testDNS(hostname = 'api.bybit.com') {
  console.log(`\n🔍 Testing DNS resolution for ${hostname}...`);
  
  try {
    const addresses = await dnsResolve(hostname);
    console.log(`✅ Resolved to: ${addresses.join(', ')}`);
    return addresses;
  } catch (error) {
    console.error(`❌ DNS resolution failed: ${error.message}`);
    throw error;
  }
}

/**
 * Compare different DNS providers
 */
export async function compareDNS(hostname = 'api.bybit.com') {
  console.log('='.repeat(60));
  console.log('🌐 DNS Provider Comparison');
  console.log('='.repeat(60));
  
  const results = {};
  
  for (const [provider, servers] of Object.entries(DNS_SERVERS)) {
    console.log(`\nTesting ${provider.toUpperCase()} DNS (${servers.join(', ')})...`);
    dns.setServers(servers);
    
    try {
      const start = Date.now();
      const addresses = await dnsResolve(hostname);
      const time = Date.now() - start;
      
      results[provider] = {
        success: true,
        addresses,
        time,
      };
      
      console.log(`✅ Success: ${addresses.join(', ')} (${time}ms)`);
    } catch (error) {
      results[provider] = {
        success: false,
        error: error.message,
      };
      
      console.log(`❌ Failed: ${error.message}`);
    }
  }
  
  console.log('\n' + '='.repeat(60));
  console.log('📊 Summary');
  console.log('='.repeat(60));
  
  const successful = Object.entries(results).filter(([_, r]) => r.success);
  
  if (successful.length === 0) {
    console.log('❌ No DNS providers could resolve the hostname');
    console.log('   The domain might be blocked at a higher level');
    console.log('   Consider using a VPN');
  } else {
    console.log(`✅ ${successful.length}/${Object.keys(DNS_SERVERS).length} providers successful`);
    
    // Find fastest
    const fastest = successful.reduce((prev, curr) => 
      curr[1].time < prev[1].time ? curr : prev
    );
    
    console.log(`⚡ Fastest: ${fastest[0].toUpperCase()} (${fastest[1].time}ms)`);
    console.log(`\nRecommendation: Use ${fastest[0].toUpperCase()} DNS`);
  }
  
  console.log('='.repeat(60));
  
  return results;
}

// If run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const hostname = process.argv[2] || 'api.bybit.com';
  
  compareDNS(hostname).catch(error => {
    console.error('Error:', error);
    process.exit(1);
  });
}

