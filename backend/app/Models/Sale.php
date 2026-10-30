<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class Sale extends Model
{
    protected $fillable = ['sale_number', 'total', 'amount_paid', 'change_given', 'status', 'sold_at', 'sold_by', 'voided_at', 'voided_by', 'approved_by', 'void_reason'];

    protected function casts(): array
    {
        return ['total' => 'decimal:2', 'amount_paid' => 'decimal:2', 'change_given' => 'decimal:2', 'sold_at' => 'datetime', 'voided_at' => 'datetime'];
    }

    public function items(): HasMany
    {
        return $this->hasMany(SaleItem::class);
    }

    public function voidedBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'voided_by');
    }

    public function approvedBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'approved_by');
    }
}
