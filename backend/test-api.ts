import { heroSMSProvider } from './src/modules/providers/herosms.provider';

async function test() {
    console.log('Testing HeroSMS getServices()...');
    const services = await heroSMSProvider.getServices();
    console.log('Services:', services.slice(0, 3), `... (${services.length} total)`);

    if (services.length > 0) {
        console.log(`\nTesting getCountries() for service ${services[0].service_name}...`);
        const countries = await heroSMSProvider.getCountries(services[0].service_code);
        console.log('Countries:', countries.slice(0, 3), `... (${countries.length} total)`);
    } else {
        console.log('No services found. Cannot test countries.');
    }
}

test().catch(console.error);
