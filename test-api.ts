import { rumahOTPProvider } from './src/modules/providers/rumahotp.provider';

async function test() {
    console.log('Testing RumahOTP getServices()...');
    const services = await rumahOTPProvider.getServices();
    console.log('Services:', services.slice(0, 3), `... (${services.length} total)`);

    if (services.length > 0) {
        console.log(`\nTesting getCountries() for service ${services[0].service_name}...`);
        const countries = await rumahOTPProvider.getCountries(services[0].service_code);
        console.log('Countries:', countries.slice(0, 3), `... (${countries.length} total)`);
    } else {
        console.log('No services found. Cannot test countries.');
    }
}

test().catch(console.error);
