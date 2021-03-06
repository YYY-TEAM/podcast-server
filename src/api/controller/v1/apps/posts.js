/* eslint-disable no-undef,no-return-await,default-case,max-depth,no-warning-comments,comma-spacing */
const BaseRest = require('./Base')
const slug = require('limax')

const fields = [
  'id',
  'author',
  'status',
  'type',
  'title',
  'name',
  'content',
  'sort',
  'excerpt',
  'date',
  'modified',
  'parent'
]

module.exports = class extends BaseRest {
  // GET API
  async indexAction () {
    // 格式化查询出来的内容
    const data = await this.getAll()
    return this.success(data)
  }

  /**
   * 获取置顶的推荐内容
   * @returns {Promise<void>}
   */
  async getStickies () {
    const stickys = this.options.stickys
    const list = await this.model('posts', {appId: this.appId})
      .getStickys(stickys, this.get('page'), this.get('pagesize'))
    return list
  }

  /**
   * 获取按分类查询的内容
   * @returns {Promise<void>}
   */
  async getByCategory (category) {
    const list = await this.model('posts', {appId: this.appId})
      .findByCategory(category, this.get('page'), this.get('pagesize'))
    return list
  }

  /**
   * 按分页查询全部内容
   * @returns {Promise<Array>}
   */
  async getAll () {
    const query = this.get()
    // console.log(query)
    // 清除两个固定条件
    Reflect.deleteProperty(query, 'appId')
    if (!think._.has(query, 'status')) {
      query.status = ['IN', ['publish', 'auto-draft', 'draft']]
    }
    // if (!think._.has(query, 'parent')) {
    //   query.parent = 0
    // }
    // query.type = 'page'
    query.type = 'post_format'

    let list = []
    // 用随机方法查询数据
    let rand = this.get('rand')
    if (think.isEmpty(rand)) {
      rand = false
    }
    // const category = this.get('category')
    if (!think.isEmpty(this.get('category'))) {
      switch (query.category) {
        case 'new' : {
          Reflect.deleteProperty(query, 'category')
          Reflect.deleteProperty(query, 'rand')
          list = await this.model('posts', {appId: this.appId}).getNews(this.get('page'), this.get('pagesize'), query)
          break
        }
        case 'popular': {
          Reflect.deleteProperty(query, 'category')
          list = await this.model('posts', {appId: this.appId}).getPopular(query, this.get('page'), this.get('pagesize') ? this.get('pagesize') : 6, rand)
          break
        }
        case 'featured': {
          const stickys = this.options.stickys
          list = await this.model('posts', {appId: this.appId}).getStickys(stickys, this.get('page'), this.get('pagesize'))
          break
        }
        default: {
          // Reflect.deleteProperty(query, 'category')
          Reflect.deleteProperty(query, 'rand')
          list = await this.model('posts', {appId: this.appId})
            .findByCategory(query, this.get('page'), this.get('pagesize'), rand)
        }
      }
    } else {

      // where({
      //   't.slug': category,
      //   'p.status': ['IN', status]
      // })

      query.status = 'publish'
      query.type = 'page'
      Reflect.deleteProperty(query, 'page')
      Reflect.deleteProperty(query, 'pagesize')
      list = await this.model('posts', {appId: this.appId})
        .where(query).field(fields.join(","))
        .order('modified DESC')
        .page(this.get('page'), this.get('pagesize')).countSelect()
    }

    // 处理数据，主要处理 meta 内容
    await this._dealData(list.data)

    // 如果需要格式化内容
    // 格式化父子关系为 tree 格式数据
    if (this.get('format') === true) {
      list.data = await this.formatData(list.data)
    }
    return list
  }

  /**
   * 处理数据
   * @param data
   * @returns {Promise<void>}
   * @private
   */
  async _dealData (data) {
    _formatMeta(data)
    const metaModel = this.model('postmeta', {appId: this.appId})

    for (let item of data) {
      if (!Object.is(item.meta._items, undefined)) {
        item.items = item.meta._items
      }

      item.url = ''
      // 如果有音频
      if (!Object.is(item.meta._audio_id, undefined)) {
        // 音频播放地址
        item.url = await metaModel.getAttachment('file', item.meta._audio_id)
      }

      const userModel = this.model('users');

      // 作者信息
      item.author = await userModel.getById(item.author)
      _formatOneMeta(item.author)
      if (think._.has(item.author, 'meta')) {
        if (!Object.is(item.author.meta[`picker_${this.appId}_wechat`], undefined)) {
          item.author.avatar = item.author.meta[`picker_${this.appId}_wechat`].avatarUrl
        } else {
          item.author.avatar = await this.model('postmeta').getAttachment('file', item.author.meta.avatar)
        }
        Reflect.deleteProperty(item.author, 'meta')
      }
      if (think._.has(item.author, 'liked')) {
        Reflect.deleteProperty(item.author, 'liked')
      }
      item.like_count = await metaModel.getLikedCount(item.id)
      item.view_count = await metaModel.getViewCount(item.id)
      const repliesCount = await this.model('comments', {appId: this.appId}).where({'comment_post_id': item.id}).count()
      // const user = this.ctx.state.user
      // item.author = user
      // 音频播放的歌词信息
      // lrc
      item.replies_count = repliesCount
      // 如果有封面 默认是 thumbnail 缩略图，如果是 podcast 就是封面特色图片 featured_image
      // if (!Object.is(item.meta['_featured_image']))
      if (!Object.is(item.meta._thumbnail_id, undefined) && !think.isEmpty(item.meta._thumbnail_id)) {
        // item.thumbnail = {
        //   id: item.meta['_thumbnail_id']
        // }
        // item.thumbnail.url = await metaModel.getAttachment('file', item.meta['_thumbnail_id'])
        item.featured_image = await metaModel.getAttachment('file', item.meta._thumbnail_id)
        if (think.isEmpty(item.featured_image)) {
          item.featured_image = this.getRandomCover()
        }
        // item.thumbnal = await metaModel.getThumbnail({post_id: item.id})
      } else {
        item.featured_image = this.getRandomCover()
      }
    }
  }

  /**
   * 搜索主题关键词
   * @returns {Promise<void>}
   */
  async searchAction () {
    const title = this.get('param')
    const postModel = this.model('posts', {appId: this.appId})
    const defaultTerm = Number(this.options.default.term)
    // 原来是默认查询  loves 分类下针对采撷最爱， 现在是按分类
    const list = await postModel.findByTitleFromTerms(defaultTerm, title, this.get('page'), this.get('pagesize'))
    const metaModel = this.model('postmeta', {appId: this.appId})
    _formatMeta(list.data)

    for (let item of list.data) {
      item.url = ''
      // 如果有封面 默认是 thumbnail 缩略图，如果是 podcast 就是封面特色图片 featured_image
      if (!Object.is(item.meta._thumbnail_id, undefined)) {
        item.featured_image = await metaModel.getAttachment('file', item.meta._thumbnail_id)
      } else {
        item.featured_image = this.getRandomCover()
      }

      // like_count
      if (!Object.is(item.meta._liked, undefined)) {
        item.like_count = item.meta._liked.length
      }
    }
    return this.success(list)
  }

  /**
   * 新建内容
   * @returns {Promise<*|boolean>}
   */
  async newAction () {
    const data = this.post()
    if (think._.has(data, 'formId')) {
      this.formId = data.formId
    }
    if (think.isEmpty(data.title)) {
      return this.fail('主题不能为空')
    }
    data.title = think.tc.filter(data.title)
    const slugName = slug(data.title, {separateNumbers: false})
    if (think.isEmpty(slugName)) {
      return this.fail('创建失败，请检查主题内容')
    }

    if (!think.isEmpty(data.content)) {
      data.content = think.tc.filter(data.content)
    }
    data.name = slugName

    const postModel = this.model('posts', {appId: this.appId})
    let hasData = await postModel.findByName(slugName)

    if (!think.isEmpty(hasData)) {
      await this.decoratorData(hasData)
      return this.success(hasData)
    }

    if (think.isEmpty(data.type)) {
      data.type = 'page'
    }
    if (!think.isEmpty(data.format)) {
      data.type = 'post_format'
    }


    if (think._.has(data, 'sticky')) {
      if (data.sticky === true) {
        await this.model('options', {appId: this.appId}).addSticky(this.id.toString())
      }
      if (data.sticky === false) {
        await this.model('options', {appId: this.appId}).removeSticky(this.id.toString())
      }
    }

    const currentTime = new Date().getTime();
    data.date = currentTime
    data.modified = currentTime

    if (!think.isEmpty(data.block)) {
      if (!think._.isArray(data.block)) {
        return this.fail('资源内容添加错误')
      }
      if (think._.isArray(data.block)) {
        const isNumber = data.block.every(think._.isNumber)
        if (!isNumber) {
          return this.fail('资源内容格式错误')
        }
      }
      data.block = JSON.stringify(data.block)
    }

    // 3 添加内容与 term 分类之间的关联
    // term_taxonomy_id
    const defaultTerm = Number(this.options.default.term)
    const defaultPostFormat = Number(this.options.default.format)

    let categories = []
    if (Object.is(data.categories, undefined) && think.isEmpty(data.categories)) {
      categories = categories.concat(defaultTerm)
    } else {
      categories = categories.concat(JSON.parse(data.categories))
    }

    // 4 获取内容的格式类别
    if (!Object.is(data.format, undefined) && !think.isEmpty(data.format)) {
      categories = categories.concat(data.format)
    }
    if (think._.hasIn(this.options, 'default.publish')) {
      const defaultPublish = this.options.default.publish
      // 处理内容默认发布状态
      const isPublish = think._.intersection(categories, defaultPublish)
      if (isPublish.length > 0) {
        data.status = 'publish'
      }
    }

    if (think.isEmpty(data.author)) {
      data.author = this.ctx.state.user.id
    }
    if (think.isEmpty(data.status)) {
      data.status = 'auto-draft';
    }

    const postId = await this.modelInstance.setRelation(false).add(data)

    // 2 更新 meta 数据
    if (!Object.is(data.meta, undefined)) {
      const metaModel = this.model('postmeta', {appId: this.appId})
      // 保存 meta 信息
      await metaModel.save(postId, data.meta)
    }

    // for (const cate of categories) {
    //   await this.model('taxonomy', {appId: this.appId}).relationships(postId, cate)
    // }

    // const defaultTerm = this.options.default.term
    // 如果这里也更新 就会删除分类的关联，所以是错误的
    // let categories = []
    if (!Object.is(data.categories, undefined) && !think.isEmpty(data.categories)) {
      const curCategories = await this.model('taxonomy', {appId: this.appId}).findCategoriesByObject(this.id.toString())
      const xors = think._.xor(think._.map(curCategories, 'term_id'), data.categories)
      // 没有添加，有就删除
      // categories = categories.concat(data.categories)
      for (const cate of xors) {
        await this.model('taxonomy', {appId: this.appId}).relationships(postId, cate)
      }
    } else {
      await this.model('taxonomy', {appId: this.appId}).relationships(postId, defaultTerm)
    }

    // await this.model('taxonomy', {appId: this.appId}).relationships(postId, defaultPostFormat)
    if (data.format) {
      data.type = 'post_format'
      await this.model('taxonomy', {appId: this.appId}).relationships(postId, data.format)
    }

    // 5 如果有关联信息，更新关联对象信息
    if (!Object.is(data.relateTo, undefined) && !think.isEmpty(data.relateTo)) {
      const metaModel = this.model('postmeta', {appId: this.appId})
      // 保存关联对象的 meta 信息
      await metaModel.related(data.relateTo, postId, data.relateStatus)
    }

    // 发布在默认类别下的内容
    // const isDefaultPost = think._.findLast(categories, (value) => {
    //   return defaultTerm === value
    // })

    // if (isDefaultPost) {
    //   6 添加 Love(like) 信息
    // await this.newLike(postId)
    // }
    let newPost = await postModel.getById(postId)
    // let newPost = await this.getPost(postId)
    await this.decoratorData(newPost)
    // 下发回忆通知
    // 0bEMgmkRis7a09BsGreIgj-paRSca9fN-pvMz5WpmH8
    // 项目名称
    // {{keyword1.DATA}}
    // 回复者
    // {{keyword2.DATA}}
    // 留言内容
    // {{keyword3.DATA}}
    // await this.wechatService.process
    //   .sendMiniProgramTemplate(
    //     'oTUP60LImdhyvE3VpMEmYSTiefu0',
    //     'Q6oT1lITd1kp3swZnJh3dRDftvtiJrEmOWeaN6AlTqM',
    //     `/page/love?id=${data.parent}`,
    //     `${this.formId}`,
    //     {
    //       keyword1: {
    //         value: `你最爱的：${data.title.split('-')[0]} 有新的回忆`,
    //         color: '#175177'
    //       },
    //       keyword2: {
    //         value: data.content
    //       },
    //       keyword3: {
    //         value: '点击进入小程序查看'
    //       }
    //     })
    return this.success(newPost)
  }

  /**
   * 新喜欢状态
   * @param postId
   * @returns {Promise<*|boolean>}
   */
  async newLike (postId) {
    const userId = this.ctx.state.user.id
    const id = postId
    let date = this.post('love_date')
    // 日期是要检查 的
    if (!think.isEmpty(date)) {
      // 验证日期的正确性
      const d = new Date(date).getFullYear()
      // const d = getMonthFormatted(new Date(date).getMonth())
      if (d === 'NaN') {
        return this.fail('日期格式错误')
      }
    } else {
      date = new Date().getFullYear()
    }
    const postMeta = this.model('postmeta', {appId: this.appId})

    const result = await postMeta.where({
      post_id: id,
      meta_key: '_liked'
    }).find()

    let likeCount = 0
    if (!think.isEmpty(result)) {
      if (!think.isEmpty(result.meta_value)) {
        likeCount = JSON.parse(result.meta_value).length
        const iLike = await think._.find(JSON.parse(result.meta_value), ['id', userId.toString()])
        if (!iLike) {
          await postMeta.newLike(userId, id, this.ip, date)
          likeCount++
        } else {
          await postMeta.updateLikeDate(userId, id, date)
        }
      }
    } else {
      // 添加
      const res = await postMeta.add({
        post_id: id,
        meta_key: '_liked',
        meta_value: ['exp', `JSON_ARRAY(JSON_OBJECT('id', '${userId}', 'ip', '${_ip2int(this.ip)}', 'date', '${date}', 'modified', '${new Date().getTime()}'))`]
      })
      if (res > 0) {
        likeCount++
      }
    }
    await this.model('users').newLike(userId, this.appId, id, date)
  }


  async decoratorData (data) {
    await this._decoratorAuthor(data)
    switch (data.type) {
      case 'page': {
        data = await this._pageData(data)
        break
      }
      case 'post_format': {
        data = await this._formatData(data)
        break
      }
      default:
        break
    }
    return data
  }

  /**
   * 装饰作者
   * @param data
   * @returns {Promise<void>}
   * @private
   */
  async _decoratorAuthor (data) {
    const metaModel = this.model('postmeta', {appId: this.appId})
    const userModel = this.model('users')

    _formatOneMeta(data)
    // 处理作者信息
    let user = await userModel.getById(data.author)
    _formatOneMeta(user)

    // 获取头像地址
    if (!think.isEmpty(user.meta[`picker_${this.appId}_wechat`])) {
      user.avatarUrl = user.meta[`picker_${this.appId}_wechat`].avatarUrl
    } else {
      user.avatarUrl = await this.model('postmeta').getAttachment('file', user.meta.avatar)
    }

    // 作者简历
    if (!Object.is(user.meta.resume, undefined)) {
      user.resume = user.meta.resume
    }

    // 如果有封面 默认是 thumbnail 缩略图，如果是 podcast 就是封面特色图片 featured_image
    // if (!Object.is(item.meta['_featured_image']))
    if (!Object.is(data.meta._thumbnail_id, undefined)) {
      data.featured_image = await metaModel.getAttachment('file', data.meta._thumbnail_id)
    }

    if (think.isEmpty(data.block)) {
      data.block = []
    }
    data.author = user
    Reflect.deleteProperty(user, 'meta')
  }

  /**
   * 更新作者
   * @returns {Promise<*>}
   */
  async changeAuthor () {
    const res = await this.model('posts', {appId: this.appId})
      .setRelation(false)
      .where({id: this.id}).update({
        author: this.post('author')
      })
    if (res > 0) {
      return this.success()
    } else {
      return this.error('更新失败')
    }
  }

  async _formatData (data) {
    const postModel = this.model('posts', {appId: this.appId})
    await this._decoratorTerms(data)
    data = await postModel.getFormatData(data)
    return data
  }

  /**
   * 获取内容
   * @param post_id
   * @returns {Promise<*>}
   */
  async _pageData (data) {
    // 获取精选内容列表
    const stickies = this.options.stickys
    // const postModel = this.model('posts', {appId: this.appId})


    // 根据 id 取内容
    // let data = await postModel.getById(postId)

    // console.log(data.type)
    // const laal = await postModel.dealFormat(data)
    // console.log(laal)
    const isSticky = think._.find(stickies, (id) => {
      return data.id.toString() === id
    })

    if (isSticky) {
      data.sticky = true
    } else {
      data.sticky = false
    }

    // 清除 meta

    // 处理分类及内容层级
    // await this._dealTerms(data)
    // 装饰类别与 format 信息
    // await this._decoratorTerms(data)
    // await this._decoratorTerms(data)

    // 处理标签信息
    await this._dealTags(data)
    //
    await this._detalBlock(data)
    //
    // await this._dealLikes(data)

    Reflect.deleteProperty(data, 'meta')

    return data

  }


  //
  // Private methods
  //
  /**
   * 处理分类信息，为查询的结果添加分类信息
   * @param post
   * @returns {Promise.<*>}
   */
  async _decoratorTerms (post) {
    const _taxonomy = this.model('taxonomy', {appId: this.appId})
    post.categories = await _taxonomy.findCategoriesByObject(post.id.toString())
    post.categories = think._.map(post.categories, 'term_taxonomy_id')
    const postFormat = await _taxonomy.getFormat(post.id)
    if (!think.isEmpty(postFormat)) {
      post.type = postFormat.slug
    }

    return post
  }

  async _detalBlock (post) {
    if (!think.isEmpty(post.block)) {
      const blockList = await this.model('posts', {appId: this.appId})
        .loadBlock(post.type, JSON.parse(post.block))
      post.block = blockList
    }
    return post

  }


  /**
   * 获取内容
   * @param post_id
   * @returns {Promise<*>}
   */
  async getPost (post_id) {
    // 获取精选内容列表
    const stickys = this.options.stickys
    const postModel = this.model('posts', {appId: this.appId})
    const metaModel = this.model('postmeta', {appId: this.appId})
    const userModel = this.model('users');

    let data = await postModel.getById(post_id)
    const isSticky = think._.find(stickys, (id) => {
      return post_id.toString() === id
    })

    if (isSticky) {
      data.sticky = true
    } else {
      data.sticky = false
    }
    _formatOneMeta(data)
    data.url = ''
    // 处理音频
    // if (!Object.is(data.meta._audio_id, undefined)) {
    //   data.url = await metaModel.getAttachment('file', item.meta._audio_id)
    // }
    // 处理作者信息
    let user = await userModel.getById(data.author)
    _formatOneMeta(user)

    // 获取头像地址
    if (!think.isEmpty(user.meta[`picker_${this.appId}_wechat`])) {
      user.avatarUrl = user.meta[`picker_${this.appId}_wechat`].avatarUrl
    } else {
      user.avatarUrl = await this.model('postmeta').getAttachment('file', user.meta.avatar)
    }

    // 作者简历
    if (!Object.is(user.meta.resume, undefined)) {
      user.resume = user.meta.resume
    }
    // 如果有封面 默认是 thumbnail 缩略图，如果是 podcast 就是封面特色图片 featured_image
    // if (!Object.is(item.meta['_featured_image']))
    if (!Object.is(data.meta._thumbnail_id, undefined)) {
      data.featured_image = await metaModel.getAttachment('file', data.meta._thumbnail_id)
    }

    if (think.isEmpty(data.block)) {
      data.block = []
    }
    data.author = user
    // 清除 meta

    // 处理分类及内容层级
    await this._dealTerms(data)
    // 处理标签信息
    await this._dealTags(data)
    await this._detalBlock(data)

    await this._dealLikes(data)

    Reflect.deleteProperty(user, 'meta')
    Reflect.deleteProperty(data, 'meta')

    return data

  }

  //
  // Private methods
  //
  /**
   * 处理分类信息，为查询的结果添加分类信息
   * @param post
   * @returns {Promise.<*>}
   */
  async _dealTerms (post) {
    const _taxonomy = this.model('taxonomy', {appId: this.appId})
    post.categories = await _taxonomy.findCategoriesByObject(post.id.toString())
    post.categories = think._.map(post.categories, 'term_id')
    const postFormat = await _taxonomy.getFormat(post.id)
    if (!think.isEmpty(postFormat)) {
      post.type = postFormat.slug
    }
    // if (!think.isEmpty(post.block)) {
    //   const blockList = await this.model('posts', {appId: this.appId})
    //     .loadBlock(post.type, JSON.parse(post.block))
    //   post.block = blockList
    // }
    return post
  }

  // async _detalBlock (post) {
  //   if (!think.isEmpty(post.block)) {
  //     const blockList = await this.model('posts', {appId: this.appId})
  //       .loadBlock(post.type, JSON.parse(post.block))
  //     post.block = blockList
  //   }
  //   return post
  //
  // }


  /**
   * 处理内容格式
   * @param list
   * @returns {Promise.<*>}
   */
  async formatData (data) {
    const _taxonomy = this.model('taxonomy', {appId: this.appId})
    for (const item of data) {
      item.format = await _taxonomy.getFormat(item.id)
    }
    // 处理内容层级
    // let treeList = await arr_to_tree(list.data, 0);
    // data = await arr_to_tree(data, 0);

    return data
  }

  /**
   * 处理内容标签信息
   * @param post
   * @returns {Promise.<void>}
   */
  async _dealTags (post) {
    const _taxonomy = this.model('taxonomy', {appId: this.appId})
    post.tags = await _taxonomy.findTagsByObject(post.id)
  }

  /**
   * 处理内容喜欢的信息
   * @param post
   * @returns {Promise.<void>}
   */
  async _dealLikes (post) {
    const userId = this.ctx.state.user.id
    const postMeta = this.model('postmeta', {appId: this.appId})

    const result = await postMeta.where({
      post_id: post.id,
      meta_key: '_liked'
    }).find()
    // 当前登录用户是否喜欢
    let iLike = false
    const likes = []
    const userModel = this.model('users')
    let totalCount = 0
    if (!think.isEmpty(result)) {
      if (!think.isEmpty(result.meta_value)) {
        const exists = await think._.find(JSON.parse(result.meta_value), ['id', userId.toString()])
        if (exists) {
          iLike = true
          post.like_date = exists.date
        }
        const list = JSON.parse(result.meta_value)
        totalCount = list.length
        for (const u of list) {
          let user = await userModel.where({id: u.id}).find()
          likes.push(user)
        }
      }
    }

    _formatMeta(likes)

    for (let user of likes) {
      Reflect.deleteProperty(user, 'meta')
    }
    post.like_count = totalCount
    post.i_like = iLike
    post.likes = likes
  }

  async __getPost (post_id) {
    let fields = [
      'id',
      'author',
      'status',
      'type',
      'title',
      'name',
      'content',
      'sort',
      'excerpt',
      'date',
      'modified',
      'parent'
    ];
    fields = unique(fields);

    let query = {}
    query.id = post_id
    query = {status: ['NOT IN', 'trash'], id: post_id}

    const list = await this.model('posts', {appId: this.appId}).where(query).field(fields.join(",")).order('sort ASC').page(this.get('page'), 10).countSelect()

    // 处理播放列表音频 Meta 信息
    _formatMeta(list.data)

    // 根据 Meta 信息中的音频附件 id 查询出音频地址
    const metaModel = this.model('postmeta', {appId: this.appId})
    for (const item of list.data) {
      item.url = ''
      // 如果有音频
      if (!Object.is(item.meta._audio_id, undefined)) {
        // 音频播放地址
        item.url = await metaModel.getAttachment('file', item.meta._audio_id)
      }
      const userModel = this.model('users');

      // 如果有作者信息
      if (!Object.is(item.meta._author_id, undefined)) {
        const author = await userModel.where({id: item.meta._author_id}).find()
        _formatOneMeta(author)
        item.authorInfo = author
        // 查询 出对应的作者信息
      } else {
        const author = await userModel.where({id: item.author}).find()
        _formatOneMeta(author)
        item.authorInfo = author

      }
      // 取得头像地址
      if (!Object.is(item.authorInfo.meta.avatar, undefined)) {
        item.authorInfo.avatar = await this.model('postmeta').getAttachment('file', item.authorInfo.meta.avatar)
      }

      // 音频播放的歌词信息
      // lrc

      // 如果有封面 默认是 thumbnail 缩略图，如果是 podcast 就是封面特色图片 featured_image
      // if (!Object.is(item.meta['_featured_image']))
      if (!Object.is(item.meta._thumbnail_id, undefined)) {
        // item.thumbnail = {
        //   id: item.meta['_thumbnail_id']
        // }
        // item.thumbnail.url = await metaModel.getAttachment('file', item.meta['_thumbnail_id'])
        item.featured_image = await metaModel.getAttachment('file', item.meta._thumbnail_id)
        // item.thumbnal = await metaModel.getThumbnail({post_id: item.id})
      }

      // 获取内容的分类信息
      // const terms = await this.model('taxonomy', {appId: this.appId}).getTermsByObject(query.id)
    }
    // 处理分类及内容层级
    await this.dealTerms(list)
    // 处理标签信息
    await this.dealTags(list)

    await this.dealLikes(list.data[0])

    return list.data[0]
  }

  /**
   * 处理分类信息，为查询的结果添加分类信息
   * @param list
   * @returns {Promise.<*>}
   */
  async dealTerms (list) {
    const _taxonomy = this.model('taxonomy', {appId: this.appId})
    for (const item of list.data) {
      item.categories = await _taxonomy.getTermsByObject(item.id)
    }
    // 处理内容层级
    // let treeList = await arr_to_tree(list.data, 0);
    list.data = await arr_to_tree(list.data, 0);

    return list
  }

  /**
   * 处理分类信息，为查询的结果添加分类信息
   * @param list
   * @returns {Promise.<*>}
   */
  async __formatData (data) {
    const _taxonomy = this.model('taxonomy', {appId: this.appId})
    for (const item of data) {
      item.format = await _taxonomy.getFormat(item.id)
    }
    // 处理内容层级
    // let treeList = await arr_to_tree(list.data, 0);
    data = await arr_to_tree(data, 0);

    return data
  }

  /**
   * 处理内容标签信息
   * @param list
   * @returns {Promise.<void>}
   */
  async dealTags (list) {
    const _taxonomy = this.model('taxonomy', {appId: this.appId})
    for (const item of list.data) {
      item.tags = await _taxonomy.findTagsByObject(item.id)
    }
  }

  // async
  /**
   * 处理内容喜欢的信息
   * @param post
   * @returns {Promise.<void>}
   */
  async dealLikes (post) {
    const userId = this.ctx.state.user.id
    const postMeta = this.model('postmeta', {appId: this.appId})

    const result = await postMeta.where({
      post_id: post.id,
      meta_key: '_liked'
    }).find()
    // 当前登录用户是否喜欢
    let iLike = false
    const likes = []
    const userModel = this.model('users')
    let totalCount = 0

    if (!think.isEmpty(result)) {
      if (!think.isEmpty(result.meta_value)) {
        const exists = await think._.find(JSON.parse(result.meta_value), ['id', userId])
        if (exists) {
          iLike = true
        }
        const list = JSON.parse(result.meta_value)
        totalCount = list.length
        for (const u of list) {
          const user = await userModel.where({id: u.id}).find()
          _formatOneMeta(user)
          likes.push(user)
        }
      }
    }

    post.like_count = totalCount
    post.i_like = iLike
    post.likes = likes
  }

  // async
  /**
   * 处理内容喜欢的信息
   * @param post
   * @returns {Promise.<void>}
   */
  async dealViews (post) {
    // const userId = this.ctx.state.user.id
    const postMeta = this.model('postmeta', {appId: this.appId})

    const result = await postMeta.where({
      post_id: post.id,
      meta_key: '_post_views'
    }).find()
    // 当前登录用户是否喜欢
    // let iLike = false
    const likes = []
    // const userModel = this.model('users')
    let totalCount = 0

    if (!think.isEmpty(result) && !think.isEmpty(result.meta_value)) {
      // if (!think.isEmpty(result.meta_value)) {
      // const exists = await think._.find(JSON.parse(result.meta_value), ['id', userId])
      // if (exists) {
      //   iLike = true
      // }
      const list = JSON.parse(result.meta_value)
      totalCount = list.length
      // for (const u of list) {
      //   const user = await userModel.where({id: u.id}).find()
      //   _formatOneMeta(user)
      //   likes.push(user)
      // }
      // }
    }
    post.view_count = totalCount
    // post.i_like = iLike
    // post.likes = likes
  }
}
