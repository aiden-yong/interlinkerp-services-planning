/** IF-06. Which provider to use is open issue OI-02; add one adapter when it is decided. */
export interface HolidayProvider {
  isConfigured(): boolean;
  /** `key` must stay the same across syncs for the same holiday. */
  holidays(year: number, countryCode: string, regionCode: string | null): Promise<{ key: string; date: string; name: string }[]>;
}

export const nullHolidayProvider: HolidayProvider = {
  isConfigured: () => false,
  holidays: async () => [],
};
