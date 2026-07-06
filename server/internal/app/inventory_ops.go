package app

import "errors"

// 背包槽位模型：定长 63 格（0-8 快捷栏，9-62 背包），与客户端 UI 下标一一对应。
// 空槽用零值 ItemStack{} 表示。

const (
	inventoryHotbarSlots = 9
	inventoryBagSlots    = 54
	inventorySlotCount   = inventoryHotbarSlots + inventoryBagSlots
)

var (
	ErrInvalidInventorySlot = errors.New("invalid inventory slot")
	ErrInventoryFull        = errors.New("inventory is full")
	ErrItemNotFound         = errors.New("item not found in inventory")
	ErrUnknownItem          = errors.New("unknown item")
	ErrInvalidQuantity      = errors.New("invalid quantity")
)

// normalizeInventory 把任意历史形态的背包规范为定长 63 槽：
// 越界物品截断合并到前 63 格，数量非法的堆叠清空，超上限的截到上限。
func normalizeInventory(container *ItemContainer) {
	items := make([]ItemStack, inventorySlotCount)
	overflow := make([]ItemStack, 0)
	for index, stack := range container.Items {
		if stack.ItemID == "" || stack.Quantity <= 0 {
			continue
		}
		if limit := itemStackLimit(stack.ItemID); stack.Quantity > limit {
			stack.Quantity = limit
		}
		if index < inventorySlotCount {
			items[index] = stack
		} else {
			overflow = append(overflow, stack)
		}
	}
	container.Items = items
	for _, stack := range overflow {
		_ = addItemToInventory(container, stack) // 尽力合并，放不下就丢弃（历史数据容错）
	}
}

// addItemToInventory 把物品堆放入背包：先合并进已有同类堆叠，再占用空槽。
// 放不下时返回 ErrInventoryFull 且不修改背包。
func addItemToInventory(container *ItemContainer, stack ItemStack) error {
	if stack.ItemID == "" || stack.Quantity <= 0 {
		return ErrInvalidQuantity
	}
	limit := itemStackLimit(stack.ItemID)

	// 先在副本上模拟，确认能全部放下再提交。
	items := make([]ItemStack, len(container.Items))
	copy(items, container.Items)
	remaining := stack.Quantity

	for index := range items {
		if remaining == 0 {
			break
		}
		if items[index].ItemID != stack.ItemID || items[index].Quantity >= limit {
			continue
		}
		space := limit - items[index].Quantity
		if space > remaining {
			space = remaining
		}
		items[index].Quantity += space
		remaining -= space
	}
	for index := range items {
		if remaining == 0 {
			break
		}
		if items[index].ItemID != "" {
			continue
		}
		amount := remaining
		if amount > limit {
			amount = limit
		}
		items[index] = ItemStack{ItemID: stack.ItemID, Quantity: amount}
		remaining -= amount
	}
	if remaining > 0 {
		return ErrInventoryFull
	}
	container.Items = items
	return nil
}

// removeItemsFromInventory 按数量表扣除物品（用于合成消耗）。
// 数量不足时返回 ErrItemNotFound 且不修改背包。
func removeItemsFromInventory(container *ItemContainer, counts map[string]int) error {
	items := make([]ItemStack, len(container.Items))
	copy(items, container.Items)

	for itemID, need := range counts {
		if need <= 0 {
			continue
		}
		remaining := need
		for index := range items {
			if items[index].ItemID != itemID {
				continue
			}
			take := items[index].Quantity
			if take > remaining {
				take = remaining
			}
			items[index].Quantity -= take
			if items[index].Quantity == 0 {
				items[index] = ItemStack{}
			}
			remaining -= take
			if remaining == 0 {
				break
			}
		}
		if remaining > 0 {
			return ErrItemNotFound
		}
	}
	container.Items = items
	return nil
}

// countItemsInInventory 统计各物品持有总数。
func countItemsInInventory(container ItemContainer, itemID string) int {
	total := 0
	for _, stack := range container.Items {
		if stack.ItemID == itemID {
			total += stack.Quantity
		}
	}
	return total
}

// moveInventoryItem 处理槽位间移动：
// 目标为空 → 移动；同物品 → 合并（尊重堆叠上限，装不下的留在原槽）；异物品 → 交换。
func moveInventoryItem(container *ItemContainer, from, to int) error {
	if from < 0 || from >= inventorySlotCount || to < 0 || to >= inventorySlotCount {
		return ErrInvalidInventorySlot
	}
	if from == to {
		return nil
	}
	source := container.Items[from]
	if source.ItemID == "" {
		return ErrItemNotFound
	}
	target := container.Items[to]

	if target.ItemID == source.ItemID {
		limit := itemStackLimit(source.ItemID)
		space := limit - target.Quantity
		if space <= 0 {
			// 目标已满：按交换处理
			container.Items[from], container.Items[to] = target, source
			return nil
		}
		moved := source.Quantity
		if moved > space {
			moved = space
		}
		target.Quantity += moved
		source.Quantity -= moved
		if source.Quantity == 0 {
			source = ItemStack{}
		}
		container.Items[from], container.Items[to] = source, target
		return nil
	}

	container.Items[from], container.Items[to] = target, source
	return nil
}

// firstEmptyInventorySlot 返回首个空槽下标，找不到返回 -1。
func firstEmptyInventorySlot(container ItemContainer) int {
	for index, stack := range container.Items {
		if stack.ItemID == "" {
			return index
		}
	}
	return -1
}

// starterInventory 新手材料包：足够合成第一把木剑和皮甲，并体验铁器合成链。
func starterInventory() ItemContainer {
	container := ItemContainer{}
	normalizeInventory(&container)
	starter := []ItemStack{
		{ItemID: "item_wood_log", Quantity: 16},
		{ItemID: "item_stone", Quantity: 8},
		{ItemID: "item_iron_ore", Quantity: 8},
		{ItemID: "item_leather", Quantity: 24},
		{ItemID: "potion_health_small", Quantity: 3},
	}
	for _, stack := range starter {
		_ = addItemToInventory(&container, stack)
	}
	return container
}
