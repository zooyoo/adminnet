/**
*
*
* @export
* @interface TreeNode
*/
export interface TreeNode {
    /**
     * @type {number}
     * @memberof TreeNode
     */
    id?: number;
    /**
     * @type {number}
     * @memberof TreeNode
     */
    pid?: number;
    /**
     * @type {string}
     * @memberof TreeNode
     */
    name?: string | null;
    /**
     * @type {Array<TreeNode>}
     * @memberof TreeNode
     */
    children?: Array<TreeNode> | null;
}
