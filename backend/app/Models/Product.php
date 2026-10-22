<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class Product extends Model
{
    protected $fillable = ['sku', 'name', 'category', 'price', 'stock', 'reorder_level', 'supplier_id'];

    protected function casts(): array
    {
        return ['price' => 'decimal:2', 'stock' => 'integer', 'reorder_level' => 'integer'];
    }

    public function supplier(): BelongsTo
    {
        return $this->belongsTo(Supplier::class);
    }
}
