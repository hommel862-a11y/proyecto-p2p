import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { CommandPalette } from './command-palette';
import { HotkeysService } from '../../core/hotkeys.service';
import { AccountsService } from '../../core/accounts.service';
import { ToastService } from '../../core/toast.service';

describe('CommandPalette', () => {
  let component: CommandPalette;
  let fixture: ComponentFixture<CommandPalette>;
  let mockRouter: { navigate: ReturnType<typeof vi.fn> };
  let mockHotkeys: {
    isPaletteOpen: ReturnType<typeof vi.fn>;
    closePalette: ReturnType<typeof vi.fn>;
    openModal: ReturnType<typeof vi.fn>;
    trigger: ReturnType<typeof vi.fn>;
  };
  let mockAccounts: {
    accounts: ReturnType<typeof vi.fn>;
    requestLiquidityModal: ReturnType<typeof vi.fn>;
    restoreDefaultAccounts: ReturnType<typeof vi.fn>;
  };
  let mockToast: {
    info: ReturnType<typeof vi.fn>;
    success: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    mockRouter = { navigate: vi.fn().mockResolvedValue(true) };
    mockHotkeys = {
      isPaletteOpen: vi.fn().mockReturnValue(true),
      closePalette: vi.fn(),
      openModal: vi.fn(),
      trigger: vi.fn(),
    };
    mockAccounts = {
      accounts: vi.fn().mockReturnValue([
        {
          id: 'provincial-pm-1',
          bankName: 'BBVA Provincial Pago Móvil',
          rail: 'PAGO_MOVIL',
          dailyLimitVes: 50000,
          initialBalanceVes: 20000,
        },
      ]),
      requestLiquidityModal: vi.fn(),
      restoreDefaultAccounts: vi.fn().mockResolvedValue(undefined),
    };
    mockToast = {
      info: vi.fn(),
      success: vi.fn(),
    };

    await TestBed.configureTestingModule({
      imports: [CommandPalette],
      providers: [
        { provide: Router, useValue: mockRouter },
        { provide: HotkeysService, useValue: mockHotkeys },
        { provide: AccountsService, useValue: mockAccounts },
        { provide: ToastService, useValue: mockToast },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(CommandPalette);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('builds commands including liquidity injection and official banks sync', () => {
    const commands = (component as unknown as { allCommands: () => Array<{ id: string; label: string }> }).allCommands();
    expect(commands.some((c) => c.id === 'action-inject-liquidity')).toBe(true);
    expect(commands.some((c) => c.id === 'action-sync-official-banks')).toBe(true);
    expect(commands.some((c) => c.id === 'action-killswitch')).toBe(true);
    expect(commands.some((c) => c.id === 'inject-provincial-pm-1')).toBe(true);
  });

  it('requests liquidity modal and navigates to dashboard when bank injection command executes', () => {
    const commands = (component as unknown as { allCommands: () => Array<{ id: string; action: () => void }> }).allCommands();
    const cmd = commands.find((c) => c.id === 'inject-provincial-pm-1');
    expect(cmd).toBeDefined();

    cmd?.action();

    expect(mockAccounts.requestLiquidityModal).toHaveBeenCalledWith('provincial-pm-1');
    expect(mockRouter.navigate).toHaveBeenCalledWith(['/dashboard'], { queryParams: { tab: 'treasury' } });
  });

  it('triggers kill switch when emergency killswitch command is executed', () => {
    const commands = (component as unknown as { allCommands: () => Array<{ id: string; action: () => void }> }).allCommands();
    const cmd = commands.find((c) => c.id === 'action-killswitch');
    expect(cmd).toBeDefined();

    cmd?.action();

    expect(mockHotkeys.trigger).toHaveBeenCalledWith('KILL_SWITCH');
  });
});
