<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Room extends Model
{
    protected $fillable = [
        'room_number',
        'monthly_rent',
        'tenant_name',
        'tenant_phone',
        'line_user_id',
        'contract_start_date',
        'deposit_amount',
        'initial_water_meter',
        'initial_electric_meter',
    ];

    public function bills(): HasMany
    {
        return $this->hasMany(Bill::class);
    }

    public function maintenanceRequests(): HasMany
    {
        return $this->hasMany(MaintenanceRequest::class);
    }
}
