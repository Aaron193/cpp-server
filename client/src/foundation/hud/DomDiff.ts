export function setTextIfChanged(node: Node | undefined, value: string): boolean {
    if (!node || node.textContent === value) return false
    node.textContent = value
    return true
}
