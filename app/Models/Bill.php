<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class Bill extends Model
{
    protected $fillable = [
        'room_id',
        'billing_month',
        'water_meter',
        'electric_meter',
        'total_amount',
        'status',
        'slip_path',
    ];

    public function room(): BelongsTo
    {
        return $this->belongsTo(Room::class);
    }
}
