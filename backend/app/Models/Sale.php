<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Sale extends Model
{
    protected $fillable = ['sale_number', 'total', 'status', 'sold_at'];

    protected function casts(): array
    {
        return ['total' => 'decimal:2', 'sold_at' => 'datetime'];
    }

    public function items(): HasMany
    {
        return $this->hasMany(SaleItem::class);
    }
}
