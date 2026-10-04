import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { ProductTourModalComponent, TOUR_CARDS } from './product-tour-modal.component';

describe('ProductTourModalComponent', () => {
  let component: ProductTourModalComponent;
  let fixture: ComponentFixture<ProductTourModalComponent>;
  let routerMock: { navigateByUrl: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    routerMock = {
      navigateByUrl: vi.fn(),
    };

    await TestBed.configureTestingModule({
      imports: [ProductTourModalComponent],
      providers: [{ provide: Router, useValue: routerMock }],
    }).compileComponents();

    fixture = TestBed.createComponent(ProductTourModalComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('debe instanciarse correctamente y cargar las 4 tarjetas del tour', () => {
    expect(component).toBeTruthy();
    expect(component.cards.length).toBe(4);
    expect(component.cards).toEqual(TOUR_CARDS);
    expect(component.activeIdx()).toBe(0);
  });

  it('permite seleccionar tarjetas directamente por índice', () => {
    component.selectCard(2);
    expect(component.activeIdx()).toBe(2);

    // Ignora índices fuera de rango
    component.selectCard(10);
    expect(component.activeIdx()).toBe(2);

    component.selectCard(-1);
    expect(component.activeIdx()).toBe(2);
  });

  it('navega secuencialmente con next() y prev() respetando los límites', () => {
    expect(component.activeIdx()).toBe(0);
    component.prev(); // No debe bajar de 0
    expect(component.activeIdx()).toBe(0);

    component.next();
    expect(component.activeIdx()).toBe(1);

    component.next();
    component.next();
    expect(component.activeIdx()).toBe(3);

    component.next(); // No debe superar 3
    expect(component.activeIdx()).toBe(3);

    component.prev();
    expect(component.activeIdx()).toBe(2);
  });

  it('responde a eventos de teclado: ArrowRight, ArrowLeft y Escape', () => {
    const closeSpy = vi.fn();
    component.modalClose.subscribe(closeSpy);

    component.handleKeyboardEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
    expect(component.activeIdx()).toBe(1);

    component.handleKeyboardEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' }));
    expect(component.activeIdx()).toBe(0);

    component.handleKeyboardEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(closeSpy).toHaveBeenCalled();
  });

  it('emite modalClose y navega a la ruta indicada en navigateAndClose()', () => {
    const closeSpy = vi.fn();
    component.modalClose.subscribe(closeSpy);

    component.navigateAndClose('/spread');

    expect(closeSpy).toHaveBeenCalled();
    expect(routerMock.navigateByUrl).toHaveBeenCalledWith('/spread');
  });
});
