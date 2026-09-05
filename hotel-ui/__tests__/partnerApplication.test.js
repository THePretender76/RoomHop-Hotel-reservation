import { describe, expect, it } from 'vitest';
import {
  PARTNER_APPLICATION_STORAGE_KEY,
  buildPartnerApplicationPayload,
  readPartnerApplication,
  savePartnerApplication,
} from '../src/pages/partnerApplication';

function createStorage(initialValue = null) {
  let value = initialValue;

  return {
    getItem: () => value,
    setItem: (key, nextValue) => {
      expect(key).toBe(PARTNER_APPLICATION_STORAGE_KEY);
      value = nextValue;
    },
  };
}

describe('partner application helpers', () => {
  it('normalizes form values before submission', () => {
    const payload = buildPartnerApplicationPayload({
      fullName: '  Ada Lovelace  ',
      corporateEmail: ' owner@example.com ',
      phoneNumber: ' +33 6 00 00 00 00 ',
      companyName: ' RoomHop Hotels ',
      taxId: ' FR123 ',
      headOfficeAddress: ' 1 Hotel Street ',
      estimatedProperties: '4',
      primaryCity: ' Paris ',
      websiteUrl: ' https://example.com ',
    });

    expect(payload).toEqual({
      fullName: 'Ada Lovelace',
      corporateEmail: 'owner@example.com',
      phoneNumber: '+33 6 00 00 00 00',
      companyName: 'RoomHop Hotels',
      taxId: 'FR123',
      headOfficeAddress: '1 Hotel Street',
      estimatedProperties: 4,
      primaryCity: 'Paris',
      websiteUrl: 'https://example.com',
    });
  });

  it('persists and restores the success-page details', () => {
    const storage = createStorage();
    const application = {
      applicantId: 42,
      corporateEmail: 'owner@example.com',
    };

    expect(savePartnerApplication(application, storage)).toBe(true);
    expect(readPartnerApplication(storage)).toEqual(application);
  });

  it('treats unavailable or malformed session storage as non-fatal', () => {
    const unavailableStorage = {
      getItem: () => { throw new Error('blocked'); },
      setItem: () => { throw new Error('blocked'); },
    };
    const malformedStorage = createStorage('{not-json');

    expect(savePartnerApplication({ applicantId: 42 }, unavailableStorage)).toBe(false);
    expect(readPartnerApplication(unavailableStorage)).toEqual({});
    expect(readPartnerApplication(malformedStorage)).toEqual({});
  });
});
