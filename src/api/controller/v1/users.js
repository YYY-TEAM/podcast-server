/* eslint-disable default-case,no-undef */
const Base = require('./Base')
const jwt = require('jsonwebtoken')

module.exports = class extends Base {
  constructor(ctx) {
    super(ctx);
    this.DAO = this.model('users')
    this.metaDAO = this.model('usermeta')
  }

  async indexAction () {
    const userId = this.get('id')
    const appid = this.get('appId')
    const userMeta = this.model('usermeta')
    let type = this.get('type')
    // const appid = 'S11SeYT2W'
    // 根据 id 获取单用户
    if (!think.isEmpty(userId)) {
      let user = await this.model('users').where({id: userId}).find()
      _formatOneMeta(user)
      if (!think.isEmpty(user.meta[`picker_${appid}_wechat`])) {
        user.avatar = user.meta[`picker_${appid}_wechat`].avatarUrl
        // user.type = 'wechat'
      } else {
        user.avatar = await this.model('postmeta').getAttachment('file', user.meta.avatar)
      }
      return this.success(user)
    } else {
      if (think.isEmpty(type)) {
        type = 'team'
      }
      // 获取用户默认获取团队成员
      const userIds = await userMeta.where(`meta_value ->'$.type' = '${type}'`).select()

      if (!think.isEmpty(userIds)) {
        const ids = []
        userIds.forEach((item) => {
          ids.push(item.user_id)
        })
        const users = await this.model('users').where({id: ['IN', ids]}).page(this.get('page'), 500).countSelect()
        _formatMeta(users.data)
        for (const user of users.data) {
          if (!think.isEmpty(user.meta.avatar)) {
            user.avatar = await this.model('postmeta').getAttachment('file', user.meta.avatar)
          } else if (!think.isEmpty(user.meta[`picker_${appid}_wechat`])) {
            user.avatar = user.meta[`picker_${appid}_wechat`].avatarUrl
            // user.type = 'wechat'
          }
        }
        return this.success(users)
      }
      return this.success([])
    }
  }

  async postAction () {
    const data = this.post()
    const approach = this.post('approach')
    // 注册用户来源
    switch(approach) {
      // 微信小程序
      case 'wechat': {
        // 判断用户是否已注册
        const wxUser = await this.model('users').getByWxApp(data.openId)
        if (!think.isEmpty(wxUser)) {
          // 获取 token
          const token = await this.createToken(approach, data)
          return this.success({userId: wxUser.id, token: token, token_type: 'Bearer'})
        } else {
          const userInfo = {
            appid: this.appId,
            user_login: data.openId,
            user_nicename: data.nickName,
            wxapp: data
          }
          const userId = await this.model('users').addWxAppUser(userInfo)
          const token = await this.createToken(approach, data)
          return this.success({userId: userId, token: token, token_type: 'Bearer'})
        }
      }
      default: {
        data.appid = this.appId
        const userId = await this.model('users').save(data)
        return this.success(userId)
      }
    }
  }

  // Get details of a user of a site by login.
  async loginAction () {
    const userLogin = this.get('user_login')
    if (think.isEmpty(userLogin)) {
      return this.fail('User login is Empty')
    }
    const user = await this.DAO.field([
      'id',
      'user_login as login',
      'user_email as email',
      'user_nicename as nicename'
    ]).where({
      user_login: userLogin
    }).find()

    // Reflect.deleteProperty(user, 'metas')
    _formatOneMeta(user)
    user.avatar = await this.model('postmeta').getAttachment('file', user.meta.avatar)
    if (!Object.is(user.meta.resume, undefined)) {
      user.resume = user.meta.resume
    }
    // 删除无用 meta 值
    Reflect.deleteProperty(user, 'meta')
    // if (user.meta.meta_key.includes('_capabilities') && user.meta.meta_key.includes('picker_')) {
    //   Object.assign(user, JSON.parse(meta.meta_value))
    // }
    // "ID": 18342963,
    //   "login": "binarysmash",
    //   "email": false,
    //   "name": "binarysmash",
    //   "URL": "http:\/\/binarysmash.wordpress.com",
    //   "avatar_URL": "http:\/\/0.gravatar.com\/avatar\/a178ebb1731d432338e6bb0158720fcc?s=96&d=identicon&r=G",
    //   "profile_URL": "http:\/\/en.gravatar.com\/binarysmash",
    //   "roles": [
    //   "administrator"
    // ]
    return this.success(user)
  }
  /**
   * 根据用户来源创建 token
   * @param approach
   * @param data
   * @returns {Promise.<*>}
   */
  async createToken(approach, data) {
    switch (approach) {
      case 'password': {
        break
      }
      case 'wxapp': {
        const token = jwt.sign(data, 'shared-secret', {expiresIn: '3d'})
        return token
      }
    }
    // const token = jwt.sign(userInfo, 'shared-secret', {expiresIn: '3d'})
    // user: userInfo.user_login,
    // return this.success({user: userInfo.user_login, token: token});
  }
}
