/**
 * Utility for parsing and modifying standard Static QRIS payloads
 * into Dynamic QRIS payloads by injecting Amount (Tag 54) and recalculating CRC.
 */
import crc16 from 'crc/crc16ccitt';

export function generateDynamicQRIS(
    staticQris: string,
    amount: number,
    referenceId?: string
): string {
    // Basic validation
    if (!staticQris || staticQris.length < 50) {
        throw new Error('Invalid static QRIS string');
    }

    // A standard QRIS string ends with Tag 63 (CRC) which is always length 04 plus 4 chars payload
    // i.e. "6304XXXX"
    const qrisWithoutCrc = staticQris.substring(0, staticQris.length - 8);

    // We will blindly append Tag 54 (Transaction Amount) if not present
    // Note: A true parser would check if 54 exists, but static QRIS usually doesn't have it.
    const amountStr = String(amount);
    const amountLen = amountStr.length.toString().padStart(2, '0');
    let newPayload = qrisWithoutCrc;

    // Remove existing Tag 54 if present (highly unlikely in static but let's be safe)
    newPayload = newPayload.replace(/54\d{2}[^O]+(?=55|56|57|58|59|60|61|62|63)/g, '');

    // Append Amount (Tag 54)
    newPayload += `54${amountLen}${amountStr}`;

    // Optionally append reference (Tag 62 -> Subtag 01 or similar, but simplified here we just
    // use a generic approach or skip. For basic dynamic QRIS, amount + new CRC is enough to make it dynamic.
    // Let's add Tag 62 (Additional Data Field) -> 07 (Terminal Label) or 01 (Bill Number)
    if (referenceId) {
        const safeRef = referenceId.substring(0, 25);
        const subtag01 = `01${safeRef.length.toString().padStart(2, '0')}${safeRef}`;
        newPayload += `62${subtag01.length.toString().padStart(2, '0')}${subtag01}`;
    }

    // Recalculate CRC using CRC-16-CCITT (polynomial 0x1021, initial value 0xFFFF)
    // The CRC is calculated over all data including the ID and Length of the CRC itself ('6304')
    newPayload += '6304';

    // Calculate CRC of the payload string
    // crc package calculates it standard, we need it as 4 hex chars, uppercase
    const calculatedCrc = crc16(newPayload).toString(16).toUpperCase().padStart(4, '0');

    return newPayload + calculatedCrc;
}
