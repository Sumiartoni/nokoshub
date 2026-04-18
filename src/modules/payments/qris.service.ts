/**
 * Utility for parsing and modifying standard Static QRIS payloads
 * into Dynamic QRIS payloads by injecting Amount (Tag 54) and recalculating CRC.
 *
 * Uses proper TLV (Tag-Length-Value) parsing to ensure correct tag ordering
 * and payload structure per EMVCo QR Code specification.
 */
import crc16 from 'crc/crc16ccitt';

// ─── TLV Helpers ──────────────────────────────────────────────────────────────

interface TLVTag {
    tag: string;
    length: number;
    value: string;
}

/**
 * Parse a QRIS/EMVCo payload string into an array of TLV tags.
 */
function parseTLV(payload: string): TLVTag[] {
    const tags: TLVTag[] = [];
    let i = 0;
    while (i + 4 <= payload.length) {
        const tag = payload.substring(i, i + 2);
        const length = parseInt(payload.substring(i + 2, i + 4), 10);
        if (isNaN(length) || i + 4 + length > payload.length) break;
        const value = payload.substring(i + 4, i + 4 + length);
        tags.push({ tag, length, value });
        i += 4 + length;
    }
    return tags;
}

/**
 * Serialize an array of TLV tags back into a payload string.
 * Tags are output in the order they appear in the array.
 */
function serializeTLV(tags: TLVTag[]): string {
    return tags
        .map((t) => `${t.tag}${t.value.length.toString().padStart(2, '0')}${t.value}`)
        .join('');
}

// ─── Main Generator ───────────────────────────────────────────────────────────

export function generateDynamicQRIS(staticQris: string, amount: number, _referenceId?: string): string {
    const normalizedQris = normalizePayload(staticQris);

    if (!normalizedQris || normalizedQris.length < 50) {
        throw new Error('Invalid static QRIS string');
    }

    try {
        return generateDynamicQRISStrict(normalizedQris, amount);
    } catch {
        return generateDynamicQRISCompat(normalizedQris, amount);
    }
}

function generateDynamicQRISCompat(staticQris: string, amount: number): string {
    if (!staticQris.includes('5802ID')) {
        throw new Error('Invalid QRIS country tag');
    }

    const withoutCrc = staticQris.replace(/6304[0-9A-Fa-f]{4}$/, '');
    const dynamicBase = withoutCrc.replace('010211', '010212');
    const amountStr = String(Math.trunc(amount));
    const amountTag = `54${amountStr.length.toString().padStart(2, '0')}${amountStr}`;
    const countryTagIndex = dynamicBase.lastIndexOf('5802ID');
    if (countryTagIndex === -1) {
        throw new Error('Invalid QRIS country tag');
    }
    const payloadWithoutCrc =
        dynamicBase.slice(0, countryTagIndex) +
        amountTag +
        dynamicBase.slice(countryTagIndex);
    const payloadForCrc = payloadWithoutCrc + '6304';
    const calculatedCrc = crc16(payloadForCrc)
        .toString(16)
        .toUpperCase()
        .padStart(4, '0');

    return payloadForCrc + calculatedCrc;
}

export function generateDynamicQRISStrict(staticQris: string, amount: number): string {
    const normalizedQris = normalizePayload(staticQris);

    if (!normalizedQris || normalizedQris.length < 50) {
        throw new Error('Invalid static QRIS string');
    }

    // 1. Parse the static QRIS into TLV tags
    const tags = parseTLV(normalizedQris);
    const consumedLength = tags.reduce((sum, tag) => sum + 4 + tag.value.length, 0);
    if (consumedLength !== normalizedQris.length) {
        throw new Error('Invalid static QRIS TLV structure');
    }

    // 2. Remove CRC tag (Tag 63) — we will recalculate it
    const tagsWithoutCrc = tags.filter((t) => t.tag !== '63');
    if (!tags.some((t) => t.tag === '63')) {
        throw new Error('Invalid static QRIS CRC tag');
    }

    // 3. Change Tag 01 (Point of Initiation Method) from "11" (Static) to "12" (Dynamic)
    let hasPointOfInitiation = false;
    for (const t of tagsWithoutCrc) {
        if (t.tag === '01') {
            t.value = '12';
            t.length = 2;
            hasPointOfInitiation = true;
        }
    }
    if (!hasPointOfInitiation) {
        throw new Error('Invalid static QRIS point of initiation tag');
    }

    // 4. Remove any existing Tag 54 (Transaction Amount).
    // Keep the rest of the merchant payload exactly as-is for broad wallet compatibility.
    const finalTags = tagsWithoutCrc.filter((t) => t.tag !== '54');

    // 5. Create new Tag 54 (Transaction Amount)
    const amountStr = String(Math.trunc(amount));
    const tag54: TLVTag = { tag: '54', length: amountStr.length, value: amountStr };

    // 6. Insert Tag 54 in the correct numerical position.
    //    Tag order: ... 52, 53, [54], 55-57, 58, 59, 60, 61, 62, 63
    const newTags: TLVTag[] = [];
    let inserted54 = false;

    for (const t of finalTags) {
        const tagNum = parseInt(t.tag, 10);

        // Insert Tag 54 before any tag with number >= 54
        if (!inserted54 && tagNum >= 54) {
            newTags.push(tag54);
            inserted54 = true;
        }

        newTags.push(t);
    }

    // If tag 54 hasn't been inserted yet (all existing tags have lower numbers), append it
    if (!inserted54) newTags.push(tag54);

    // 7. Serialize tags and append CRC placeholder
    const payloadWithoutCrc = serializeTLV(newTags);
    const payloadForCrc = payloadWithoutCrc + '6304';

    // 8. Calculate CRC-16/CCITT-FALSE (polynomial 0x1021, init 0xFFFF)
    const calculatedCrc = crc16(payloadForCrc)
        .toString(16)
        .toUpperCase()
        .padStart(4, '0');

    return payloadForCrc + calculatedCrc;
}

function normalizePayload(payload: string): string {
    return payload.replace(/[\r\n\t]/g, '').trim();
}
