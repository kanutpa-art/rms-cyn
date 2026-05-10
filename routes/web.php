<?php

use Illuminate\Support\Facades\Route;
use App\Http\Controllers\AdminController;
use App\Http\Controllers\TenantController;
use App\Http\Controllers\RoomController;

// ----------------------------------------------------
// Admin Routes (ฝั่งแอดมิน)
// ----------------------------------------------------
Route::prefix('admin')->name('admin.')->group(function () {
    Route::get('/dashboard', [AdminController::class, 'dashboard'])->name('dashboard');
    
    // ระบบจัดการห้องพัก (CRUD)
    Route::post('rooms/{room}/checkout', [RoomController::class, 'checkout'])->name('rooms.checkout');
    Route::resource('rooms', RoomController::class);
    
    // ระบบการออกบิล
    Route::get('/billing', [AdminController::class, 'billing'])->name('billing.index');
    Route::post('/bills/generate', [AdminController::class, 'storeBills'])->name('bills.generate');
    
    // ระบบตรวจสอบสลิปและเปลี่ยนสถานะ
    Route::post('/bills/{id}/pay', [AdminController::class, 'markAsPaid'])->name('bills.pay');

    // ระบบแจ้งซ่อม (Maintenance)
    Route::get('/maintenance', [MaintenanceController::class, 'index'])->name('maintenance.index');
    Route::patch('/maintenance/{maintenanceRequest}/status', [MaintenanceController::class, 'updateStatus'])->name('maintenance.updateStatus');
    
    // Fallback views & Settings
    Route::view('/payments', 'admin.dashboard')->name('payments.index');
    Route::get('/settings', [SettingController::class, 'index'])->name('settings.index');
    Route::post('/settings', [SettingController::class, 'store'])->name('settings.store');
});

// ----------------------------------------------------
// Tenant Routes (ฝั่งผู้เช่าผ่านมือถือ)
// ----------------------------------------------------
Route::prefix('tenant')->name('tenant.')->group(function () {
    Route::get('/dashboard', [TenantController::class, 'dashboard'])->name('dashboard');
    Route::post('/maintenance', [MaintenanceController::class, 'store'])->name('maintenance.store');
    
    // Fallback routes for UI buttons
    Route::view('/bills/{id}', 'tenant.dashboard')->name('bills.show');
    Route::view('/payments/create', 'tenant.dashboard')->name('payments.create');
    Route::view('/meter', 'tenant.dashboard')->name('meter.create');
    Route::view('/maintenance', 'tenant.dashboard')->name('maintenance.create');
});
