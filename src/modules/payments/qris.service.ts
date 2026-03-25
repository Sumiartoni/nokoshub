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

export function generateDynamicQRIS(
    staticQris: string,
    amount: number,
    referenceId?: string
): string {
    if (!staticQris || staticQris.length < 50) {
        throw new Error('Invalid static QRIS string');
    }

    // 1. Parse the static QRIS into TLV tags
    const tags = parseTLV(staticQris);

    // 2. Remove CRC tag (Tag 63) — we will recalculate it
    const tagsWithoutCrc = tags.filter((t) => t.tag !== '63');

    // 3. Change Tag 01 (Point of Initiation Method) from "11" (Static) to "12" (Dynamic)
    for (const t of tagsWithoutCrc) {
        if (t.tag === '01') {
            t.value = '12';
            t.length = 2;
        }
    }

    // 4. Remove any existing Tag 54 (Transaction Amount) and Tag 62 (Additional Data)
    let finalTags = tagsWithoutCrc.filter((t) => t.tag !== '54' && t.tag !== '62');

    // 5. Create new Tag 54 (Transaction Amount)
    const amountStr = String(amount);
    const tag54: TLVTag = { tag: '54', length: amountStr.length, value: amountStr };

    // 6. Create new Tag 62 (Additional Data Field) with Bill Number (subtag 01) if reference provided
    let tag62: TLVTag | null = null;
    if (referenceId) {
        const safeRef = referenceId.substring(0, 25);
        const subtag01 = `01${safeRef.length.toString().padStart(2, '0')}${safeRef}`;
        tag62 = { tag: '62', length: subtag01.length, value: subtag01 };
    }

    // 7. Insert Tag 54 and Tag 62 in the correct numerical position
    //    Tag order: ... 52, 53, [54], 55-57, 58, 59, 60, 61, [62], 63
    const newTags: TLVTag[] = [];
    let inserted54 = false;
    let inserted62 = false;

    for (const t of finalTags) {
        const tagNum = parseInt(t.tag, 10);

        // Insert Tag 54 before any tag with number >= 54
        if (!inserted54 && tagNum >= 54) {
            newTags.push(tag54);
            inserted54 = true;
        }

        // Insert Tag 62 before any tag with number >= 62
        if (!inserted62 && tag62 && tagNum >= 62) {
            newTags.push(tag62);
            inserted62 = true;
        }

        newTags.push(t);
    }

    // If tags 54/62 haven't been inserted yet (all existing tags have lower numbers), append them
    if (!inserted54) newTags.push(tag54);
    if (!inserted62 && tag62) newTags.push(tag62);

    // 8. Serialize tags and append CRC placeholder
    const payloadWithoutCrc = serializeTLV(newTags);
    const payloadForCrc = payloadWithoutCrc + '6304';

    // 9. Calculate CRC-16/CCITT-FALSE (polynomial 0x1021, init 0xFFFF)
    const calculatedCrc = crc16(payloadForCrc)
        .toString(16)
        .toUpperCase()
        .padStart(4, '0');

    return payloadForCrc + calculatedCrc;
}
