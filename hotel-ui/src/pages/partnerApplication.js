export const PARTNER_APPLICATION_STORAGE_KEY = 'roomhop_partner_application';

export function buildPartnerApplicationPayload(form) {
  return {
    fullName: form.fullName.trim(),
    corporateEmail: form.corporateEmail.trim(),
    phoneNumber: form.phoneNumber.trim(),
    companyName: form.companyName.trim(),
    taxId: form.taxId.trim(),
    headOfficeAddress: form.headOfficeAddress.trim(),
    estimatedProperties: Number(form.estimatedProperties),
    primaryCity: form.primaryCity.trim(),
    websiteUrl: form.websiteUrl.trim(),
  };
}

export function savePartnerApplication(application, storage = globalThis.sessionStorage) {
  try {
    storage?.setItem(PARTNER_APPLICATION_STORAGE_KEY, JSON.stringify(application));
    return true;
  } catch {
    // Storage is a convenience for refreshes; it must never turn a successful
    // API submission into a visible failure.
    return false;
  }
}

export function readPartnerApplication(storage = globalThis.sessionStorage) {
  try {
    const parsed = JSON.parse(storage?.getItem(PARTNER_APPLICATION_STORAGE_KEY) || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}
