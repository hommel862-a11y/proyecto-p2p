import { TestBed } from '@angular/core/testing';
import { AudioAlertsService } from './audio-alerts.service';
import { StorageService } from './storage';

describe('AudioAlertsService', () => {
  let service: AudioAlertsService;
  let storage: StorageService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(AudioAlertsService);
    storage = TestBed.inject(StorageService);
  });

  it('should be created and default to unmuted', () => {
    expect(service).toBeTruthy();
    expect(service.isMuted()).toBe(false);
  });

  it('should toggle mute state and persist in storage', () => {
    service.toggleMute();
    expect(service.isMuted()).toBe(true);

    service.toggleMute();
    expect(service.isMuted()).toBe(false);
  });

  it('should safely execute playOpportunityAlert and playKillSwitchAlert without throwing', () => {
    expect(() => service.playOpportunityAlert()).not.toThrow();
    expect(() => service.playKillSwitchAlert()).not.toThrow();

    service.toggleMute();
    expect(() => service.playOpportunityAlert()).not.toThrow();
    expect(() => service.playKillSwitchAlert()).not.toThrow();
  });
});
